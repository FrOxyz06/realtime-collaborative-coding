"""Small, trusted-local-code benchmark protocol shared by both extensions."""
import cProfile
import hashlib
import platform
import pstats
import tracemalloc
from datetime import datetime, timezone
import contextlib
import copy
import io
import json
import math
import statistics
import subprocess
import sys
import time
from pathlib import Path


class Capture(io.StringIO):
    def write(self, text):
        if self.tell() + len(text) > 16000:
            raise ValueError("Function output exceeded 16000 characters")
        return super().write(text)


def snapshot(value):
    # Preserve types: True, 1, and 1.0 should not silently compare equal.
    if value is None or type(value) in (bool, int, str):
        return [type(value).__name__, value]
    if type(value) is float and math.isfinite(value):
        return ['float', value]
    if type(value) in (list, tuple):
        return [type(value).__name__, [snapshot(x) for x in value]]
    if type(value) is dict and all(type(k) is str for k in value):
        return ['dict', {k: snapshot(v) for k, v in value.items()}]
    raise ValueError('Return values must be finite JSON values or tuples')


def validate(request):
    if type(request.get('schemaVersion')) is not int or request['schemaVersion'] != 1:
        raise ValueError('Expected benchmark schemaVersion 1')
    name = request.get('function', '')
    if not isinstance(name, str) or not name.isidentifier():
        raise ValueError('Use one top-level function name')
    cases = request.get('cases')
    if not isinstance(cases, list) or not 1 <= len(cases) <= 20:
        raise ValueError('Provide 1 to 20 cases')
    repeats = request.get('repeats', 5)
    if type(repeats) is not int or not 1 <= repeats <= 10:
        raise ValueError('repeats must be an integer from 1 to 10')
    for case in cases:
        if not isinstance(case, dict) or not isinstance(case.get('args', []), list) or not isinstance(case.get('kwargs', {}), dict):
            raise ValueError('Each case needs an args array and optional kwargs object')
        if not set(case) <= {'name', 'args', 'kwargs', 'expected', 'expectedError'}:
            raise ValueError('Unknown case field')
        if 'expectedError' in case and (not isinstance(case['expectedError'], str) or 'expected' in case):
            raise ValueError('expectedError must be a class name and cannot be combined with expected')
    for key in ('before', 'after'):
        if not isinstance(request.get(key), str) or len(request[key]) > 200000:
            raise ValueError('before and after must be source strings under 200000 characters')
    json.dumps(request, allow_nan=False)


def invoke(function, args, kwargs, case):
    try:
        value = function(*args, **kwargs)
    except Exception as error:
        if case.get('expectedError') != type(error).__name__:
            raise
        return {'expectedError': type(error).__name__, 'message': str(error)}
    if 'expectedError' in case:
        raise ValueError('Expected exception was not raised')
    return value


def worker(request):
    sys.path.insert(0, str(Path.cwd()))
    namespace = {'__name__': 'benchmark_target', '__file__': str(Path.cwd() / 'benchmark_target.py')}
    # Avoid mixing user output with the JSON protocol.
    with contextlib.redirect_stdout(Capture()), contextlib.redirect_stderr(Capture()):
        exec(compile(request['source'], namespace['__file__'], 'exec'), namespace)
        function = namespace.get(request['function'])
        if not callable(function):
            raise ValueError('Function was not found or is not callable')
        results = []
        for case in request['cases']:
            samples = []
            first = None
            # One warm-up call is checked but excluded from timing.
            for iteration in range(request.get('repeats', 5) + 1):
                args = copy.deepcopy(case.get('args', []))
                kwargs = copy.deepcopy(case.get('kwargs', {}))
                stdout, stderr = Capture(), Capture()
                with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    start = time.perf_counter_ns()
                    value = invoke(function, args, kwargs, case)
                    elapsed = time.perf_counter_ns() - start
                observed = {'return': snapshot(value), 'args': snapshot(args),
                            'kwargs': snapshot(kwargs), 'stdout': stdout.getvalue(),
                            'stderr': stderr.getvalue()}
                if first is not None and observed != first:
                    raise ValueError('Function produced inconsistent results across repeats')
                first = observed
                if 'expected' in case and snapshot(value) != snapshot(case['expected']):
                    raise ValueError('Return value does not match expected')
                if iteration > 0:
                    samples.append(elapsed / 1_000_000)
            median = statistics.median(samples)
            measurements = {'observed': first, 'medianMs': median, 'minMs': min(samples),
                'maxMs': max(samples), 'samplesMs': samples,
                'madMs': statistics.median(abs(x - median) for x in samples)}
            # Separate diagnostic calls keep profiler overhead out of timing samples.
            profiler = cProfile.Profile()
            for diagnostic in ('profile', 'memory'):
                args = copy.deepcopy(case.get('args', []))
                kwargs = copy.deepcopy(case.get('kwargs', {}))
                stdout, stderr = Capture(), Capture()
                try:
                    if diagnostic == 'memory':
                        tracemalloc.start()
                    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                        value = profiler.runcall(invoke, function, args, kwargs, case) if diagnostic == 'profile' else invoke(function, args, kwargs, case)
                    if diagnostic == 'memory':
                        measurements['peakBytes'] = tracemalloc.get_traced_memory()[1]
                finally:
                    if diagnostic == 'memory':
                        tracemalloc.stop()
                observed = {'return': snapshot(value), 'args': snapshot(args), 'kwargs': snapshot(kwargs),
                            'stdout': stdout.getvalue(), 'stderr': stderr.getvalue()}
                if observed != first:
                    raise ValueError('Diagnostic call produced inconsistent results')
            hotspots = []
            for (filename, line, name), (primitive, calls, own, cumulative, _) in pstats.Stats(profiler).stats.items():
                if filename == namespace['__file__']:
                    hotspots.append({'function': name, 'line': line, 'calls': calls,
                        'selfMs': own * 1000, 'cumulativeMs': cumulative * 1000})
            measurements['hotspots'] = sorted(hotspots, key=lambda item: item['cumulativeMs'], reverse=True)[:5]
            results.append(measurements)
    return results


def compare(request):
    if request.get('mode') == 'profile':
        request = dict(request, after=request.get('before'))
    validate(request)
    sides = {}
    mode = request.get('mode', 'compare')
    if mode not in ('compare', 'profile'):
        raise ValueError('Unknown benchmark mode')
    for side in (('before',) if mode == 'profile' else ('before', 'after')):
        payload = dict(request, source=request[side])
        try:
            child = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--worker'],
                input=json.dumps(payload), capture_output=True, text=True, timeout=5,
                encoding='utf-8')
            if child.returncode != 0:
                raise ValueError('Worker failed: ' + child.stderr[:500])
            result = json.loads(child.stdout)
            if 'error' in result:
                raise ValueError(result['error'])
            sides[side] = result['cases']
        except subprocess.TimeoutExpired:
            raise ValueError(side + ' exceeded the 5 second limit') from None
    cases = []
    for i, before in enumerate(sides['before']):
        item = {'name': str(request['cases'][i].get('name', 'Case ' + str(i + 1))), 'passed': True}
        metrics = {key: value for key, value in before.items() if key != 'observed'}
        if mode == 'profile':
            item.update(metrics)
        else:
            after = sides['after'][i]
            item.update(passed=before['observed'] == after['observed'],
                beforeMs=before['medianMs'], afterMs=after['medianMs'], before=metrics,
                after={key: value for key, value in after.items() if key != 'observed'})
            noisy = any(side['madMs'] > side['medianMs'] * 0.1 for side in (before, after))
            item['timingNote'] = 'noisy' if noisy else ('too short' if min(before['medianMs'], after['medianMs']) < 0.1 else 'measurable')
            if item['passed'] and item['timingNote'] == 'measurable' and after['medianMs'] > 0:
                item['speedup'] = before['medianMs'] / after['medianMs']
        cases.append(item)
    return {'schemaVersion': 1, 'mode': mode, 'passed': all(case['passed'] for case in cases), 'cases': cases,
        'recordedAt': datetime.now(timezone.utc).isoformat(),
        'environment': {'python': platform.python_version(), 'os': platform.system(), 'machine': platform.machine()},
        'sourceHashes': {side: hashlib.sha256(request[side].encode('utf-8')).hexdigest() for side in sides},
        'configHash': hashlib.sha256(json.dumps({key: request.get(key) for key in ('schemaVersion', 'function', 'repeats', 'cases')}, sort_keys=True).encode()).hexdigest()}



if __name__ == '__main__':
    try:
        raw = sys.stdin.read(1000001)
        if len(raw) > 1000000:
            raise ValueError('Benchmark input is too large')
        request = json.loads(raw)
        result = {'cases': worker(request)} if '--worker' in sys.argv else compare(request)
    except Exception as error:
        result = {'schemaVersion': 1, 'passed': False, 'error': str(error)[:1000]}
    print(json.dumps(result, allow_nan=False))
