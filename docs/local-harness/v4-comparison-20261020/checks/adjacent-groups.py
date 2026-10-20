import importlib.util,sys,traceback
try:
    p=importlib.util.spec_from_file_location("solution",sys.argv[1])
    s=importlib.util.module_from_spec(p)
    p.loader.exec_module(s)
    x = [1, 1, 2, 1, 1, 3]
    r = s.group_runs(x)
    assert r == [[1, 1], [2], [1, 1], [3]]
    assert x == [1, 1, 2, 1, 1, 3]
    assert s.group_runs([]) == []
    assert s.group_runs([None, None, False]) == [[None, None], [False]]
    r[0].append(9)
    assert x == [1, 1, 2, 1, 1, 3]
except AssertionError:
    traceback.print_exc()
    sys.exit(1)
except BaseException:
    traceback.print_exc()
    sys.exit(2)
