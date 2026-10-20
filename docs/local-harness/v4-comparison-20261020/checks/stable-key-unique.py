import importlib.util,sys,traceback
try:
    p=importlib.util.spec_from_file_location("solution",sys.argv[1])
    s=importlib.util.module_from_spec(p)
    p.loader.exec_module(s)
    a = {'id': [1], 'v': 'first'}
    b = {'id': [2], 'v': 'second'}
    c = {'id': [1], 'v': 'later'}
    x = [a, b, c]
    r = s.unique_records(x, 'id')
    assert r == [a, b] and r[0] is a and r[1] is b
    assert x == [a, b, c] and a == {'id': [1], 'v': 'first'}
    assert s.unique_records([{'id': {'x': 1}}, {'id': {'x': 1}}], 'id') == [{'id': {'x': 1}}]
    assert s.unique_records([], 'id') == []
    try: s.unique_records([{'other': 1}], 'id')
    except KeyError: pass
    else: raise AssertionError('missing field accepted')
except AssertionError:
    traceback.print_exc()
    sys.exit(1)
except BaseException:
    traceback.print_exc()
    sys.exit(2)
