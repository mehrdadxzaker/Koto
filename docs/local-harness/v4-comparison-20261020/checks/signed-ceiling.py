import importlib.util,sys,traceback
try:
    p=importlib.util.spec_from_file_location("solution",sys.argv[1])
    s=importlib.util.module_from_spec(p)
    p.loader.exec_module(s)
    assert s.ceil_div(7, 3) == 3
    assert s.ceil_div(-7, 3) == -2
    assert s.ceil_div(0, 7) == 0
    assert s.ceil_div(10**60 + 1, 10) == 10**59 + 1
    for d in (0, -1):
        try: s.ceil_div(1, d)
        except ValueError: pass
        else: raise AssertionError('invalid divisor accepted')
except AssertionError:
    traceback.print_exc()
    sys.exit(1)
except BaseException:
    traceback.print_exc()
    sys.exit(2)
