import importlib.util,sys,traceback
try:
    p=importlib.util.spec_from_file_location("solution",sys.argv[1])
    s=importlib.util.module_from_spec(p)
    p.loader.exec_module(s)
    assert s.replace_first('a.a.a', '.', '-') == 'a-a.a'
    assert s.replace_first('aaaa', 'aa', 'x') == 'xaa'
    assert s.replace_first('abc', 'z', 'x') == 'abc'
    assert s.replace_first('aab', 'a', '') == 'ab'
    try: s.replace_first('abc', '', 'x')
    except ValueError: pass
    else: raise AssertionError('empty needle accepted')
except AssertionError:
    traceback.print_exc()
    sys.exit(1)
except BaseException:
    traceback.print_exc()
    sys.exit(2)
