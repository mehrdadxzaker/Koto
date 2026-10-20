import importlib.util,sys,traceback
try:
    p=importlib.util.spec_from_file_location("solution",sys.argv[1])
    s=importlib.util.module_from_spec(p)
    p.loader.exec_module(s)
    x = {'a': 5, 'b': 2}
    assert s.consume_stock(x, [('a', 2), ('a', 3), ('b', 0)]) is x
    assert x == {'a': 0, 'b': 2}
    for requests, error in [([('a', 2), ('a', 4)], ValueError), ([('a', 1), ('b', -1)], ValueError), ([('a', 1), ('z', 0)], KeyError)]:
        x = {'a': 5, 'b': 2}
        try: s.consume_stock(x, requests)
        except error: pass
        else: raise AssertionError('invalid batch accepted')
        assert x == {'a': 5, 'b': 2}
    x = {'a': 5}
    assert s.consume_stock(x, []) is x
except AssertionError:
    traceback.print_exc()
    sys.exit(1)
except BaseException:
    traceback.print_exc()
    sys.exit(2)
