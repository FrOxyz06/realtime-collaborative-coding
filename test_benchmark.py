import copy
import unittest
import benchmark


class BenchmarkTests(unittest.TestCase):
    def request(self, before='def f(x): return x + 1', after='def f(x): return 1 + x'):
        return {'schemaVersion': 1, 'function': 'f', 'repeats': 2,
                'cases': [{'args': [2], 'expected': 3}], 'before': before, 'after': after}

    def test_matching_results(self):
        result = benchmark.compare(self.request())
        self.assertTrue(result['passed'])
        self.assertGreaterEqual(result['cases'][0]['beforeMs'], 0)

    def test_wrong_result_fails(self):
        request = self.request(after='def f(x): return x + 2')
        request['cases'][0].pop('expected')
        self.assertFalse(benchmark.compare(request)['passed'])

    def test_expected_value_checked_on_both_sides(self):
        with self.assertRaisesRegex(ValueError, 'expected'):
            benchmark.compare(self.request(before='def f(x): return 0'))
        with self.assertRaisesRegex(ValueError, 'expected'):
            benchmark.compare(self.request(after='def f(x): return 0'))

    def test_type_changes_fail(self):
        request = self.request(before='def f(x): return 1', after='def f(x): return True')
        request['cases'][0].pop('expected')
        self.assertFalse(benchmark.compare(request)['passed'])

    def test_argument_mutation_checked(self):
        request = self.request('def f(x): return len(x)', 'def f(x):\n x.sort()\n return len(x)')
        request['cases'] = [{'args': [[2, 1]]}]
        self.assertFalse(benchmark.compare(request)['passed'])

    def test_printed_output_checked(self):
        request = self.request(after='def f(x):\n print("extra")\n return x + 1')
        self.assertFalse(benchmark.compare(request)['passed'])

    def test_repeats_use_fresh_arguments(self):
        source = 'def f(x):\n x.append(1)\n return len(x)'
        request = self.request(source, source)
        request['cases'] = [{'args': [[]], 'expected': 1}]
        original = copy.deepcopy(request)
        self.assertTrue(benchmark.compare(request)['passed'])
        self.assertEqual(request, original)

    def test_stateful_results_rejected(self):
        request = self.request(after='count = 0\ndef f(x):\n global count\n count += 1\n return count')
        request['cases'][0].pop('expected')
        with self.assertRaisesRegex(ValueError, 'inconsistent'):
            benchmark.compare(request)

    def test_exceptions_rejected(self):
        with self.assertRaisesRegex(ValueError, 'division'):
            benchmark.compare(self.request(after='def f(x): return 1/0'))

    def test_missing_function(self):
        with self.assertRaisesRegex(ValueError, 'not found'):
            benchmark.compare(self.request(after='def other(x): return x'))

    def test_timeout(self):
        with self.assertRaisesRegex(ValueError, '5 second'):
            benchmark.compare(self.request(after='import time\ndef f(x): time.sleep(10)'))

    def test_output_limit(self):
        with self.assertRaisesRegex(ValueError, 'output exceeded'):
            benchmark.compare(self.request(after='def f(x):\n print("x" * 20000)\n return x+1'))

    def test_schema_limits(self):
        for field, value in [('schemaVersion', 2), ('function', 'a.b'), ('repeats', 0),
                             ('repeats', True), ('cases', []), ('cases', [{}] * 21),
                             ('cases', [{'args': 'bad'}]), ('before', 'x' * 200001)]:
            with self.subTest(field=field, value=str(value)[:20]):
                request = self.request()
                request[field] = value
                with self.assertRaises(ValueError):
                    benchmark.compare(request)


if __name__ == '__main__':
    unittest.main()
