"""Small, trusted-local-code benchmark protocol shared by both extensions."""
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
    if request.get('schemaVersion') != 1:
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
        if not set(case) <= {'name', 'args', 'kwargs', 'expected'}:
            raise ValueError('Unknown case field')
    for key in ('before', 'after'):
        if not isinstance(request.get(key), str) or len(request[key]) > 200000:
            raise ValueError('before and after must be source strings under 200000 characters')
    json.dumps(request, allow_nan=False)


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
            for _ in range(request.get('repeats', 5)):
                args = copy.deepcopy(case.get('args', []))
                kwargs = copy.deepcopy(case.get('kwargs', {}))
                stdout, stderr = Capture(), Capture()
                with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    start = time.perf_counter_ns()
                    value = function(*args, **kwargs)
                    elapsed = time.perf_counter_ns() - start
                observed = {'return': snapshot(value), 'args': snapshot(args),
                            'kwargs': snapshot(kwargs), 'stdout': stdout.getvalue(),
                            'stderr': stderr.getvalue()}
                if first is not None and observed != first:
                    raise ValueError('Function produced inconsistent results across repeats')
                first = observed
                if 'expected' in case and snapshot(value) != snapshot(case['expected']):
                    raise ValueError('Return value does not match expected')
                samples.append(elapsed / 1_000_000)
            results.append({'observed': first, 'medianMs': statistics.median(samples)})
    return results


def compare(request):
    validate(request)
    sides = {}
    for side in ('before', 'after'):
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
    for i, (before, after) in enumerate(zip(sides['before'], sides['after'])):
        cases.append({'name': str(request['cases'][i].get('name', 'Case ' + str(i + 1))),
                      'passed': before['observed'] == after['observed'],
                      'beforeMs': before['medianMs'], 'afterMs': after['medianMs']})
    return {'schemaVersion': 1, 'passed': all(case['passed'] for case in cases), 'cases': cases}


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
