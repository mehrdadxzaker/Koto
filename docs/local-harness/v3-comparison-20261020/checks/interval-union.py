import importlib.util,sys,traceback
try:
    p=importlib.util.spec_from_file_location("solution",sys.argv[1])
    s=importlib.util.module_from_spec(p)
    p.loader.exec_module(s)
    x = [(5, 7), (1, 3), (2, 5), (9, 9)]
    assert s.merge_intervals(x) == [(1, 7), (9, 9)]
    assert x == [(5, 7), (1, 3), (2, 5), (9, 9)]
    assert s.merge_intervals([]) == []
    assert s.merge_intervals([(1, 10), (2, 3), (10, 12)]) == [(1, 12)]
    try: s.merge_intervals([(0, 2), (5, 4)])
    except ValueError: pass
    else: raise AssertionError('reversed interval accepted')
except AssertionError:
    traceback.print_exc()
    sys.exit(1)
except BaseException:
    traceback.print_exc()
    sys.exit(2)
