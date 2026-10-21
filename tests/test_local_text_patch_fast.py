"""Literal edit data becomes bounded native patch text without executing a tool."""
from copy import deepcopy
import unittest

from hormuz.local_text_patch import TEXT_PATCH_SCHEMA, compile_text_patch


class LocalTextPatchTests(unittest.TestCase):
    def edit(self, **changes):
        return {'path': 'package/solution.py', 'old_text': 'return value',
                'new_text': 'return value + 1', **changes}

    def test_schema_is_closed_and_requires_only_the_three_literal_string_fields(self):
        schema = TEXT_PATCH_SCHEMA
        self.assertEqual(schema['type'], 'object')
        self.assertFalse(schema['additionalProperties'])
        self.assertEqual(set(schema['required']), {'path', 'old_text', 'new_text'})
        self.assertEqual(set(schema['properties']), {'path', 'old_text', 'new_text'})
        for field in ('path', 'old_text', 'new_text'):
            self.assertEqual(schema['properties'][field]['type'], 'string')
        self.assertEqual(schema['properties']['old_text']['minLength'], 1)
        self.assertEqual(schema['properties']['new_text'].get('minLength', 0), 0)

    def test_multiline_replacement_preserves_blank_lines_and_uses_one_plain_context_marker(self):
        edit = self.edit(old_text='def transform(value):\n\n    return value',
                         new_text='def transform(value):\n    """Preserve blank lines."""\n\n    return value + 1')
        expected = ('*** Begin Patch\n'
                    '*** Update File: package/solution.py\n'
                    '@@\n'
                    '-def transform(value):\n'
                    '-\n'
                    '-    return value\n'
                    '+def transform(value):\n'
                    '+    """Preserve blank lines."""\n'
                    '+\n'
                    '+    return value + 1\n'
                    '*** End Patch\n')
        self.assertEqual(compile_text_patch(edit), expected)

    def test_leading_and_interior_empty_lines_are_real_deletions_and_additions(self):
        self.assertEqual(compile_text_patch(self.edit(old_text='\nalpha\n\nomega',
                                                      new_text='\nbeta\n\nomega')),
            '*** Begin Patch\n*** Update File: package/solution.py\n@@\n'
            '-\n-alpha\n-\n-omega\n+\n+beta\n+\n+omega\n*** End Patch\n')

    def test_patch_looking_source_lines_remain_literal_prefixed_content(self):
        edit = self.edit(old_text='*** End Patch\n@@\n-old\n+new',
                         new_text='*** Begin Patch\n*** Update File: nested/target.py\n@@ -1,2 +1,2 @@\n*** End Patch')
        self.assertEqual(compile_text_patch(edit),
            '*** Begin Patch\n*** Update File: package/solution.py\n@@\n'
            '-*** End Patch\n-@@\n--old\n-+new\n'
            '+*** Begin Patch\n+*** Update File: nested/target.py\n'
            '+@@ -1,2 +1,2 @@\n+*** End Patch\n*** End Patch\n')

    def test_unicode_quotes_and_spaces_are_preserved_without_shell_escaping(self):
        edit = self.edit(path='package/with spaces/solution.py',
                         old_text="label = 'café' # 🐈\nprint(\"before\")",
                         new_text='label = "naïve’s café" # 🐈\nprint(\'after\')')
        self.assertEqual(compile_text_patch(edit),
            '*** Begin Patch\n*** Update File: package/with spaces/solution.py\n@@\n'
            '-label = \'café\' # 🐈\n-print("before")\n'
            '+label = "naïve’s café" # 🐈\n+print(\'after\')\n*** End Patch\n')

    def test_empty_replacement_deletes_the_supplied_lines(self):
        self.assertEqual(compile_text_patch(self.edit(old_text='remove\nthese', new_text='')),
            '*** Begin Patch\n*** Update File: package/solution.py\n@@\n'
            '-remove\n-these\n*** End Patch\n')

    def test_terminal_lf_is_a_separator_and_extra_blank_lines_remain_content(self):
        self.assertEqual(compile_text_patch(self.edit(old_text='before\n', new_text='after\n')),
                         compile_text_patch(self.edit(old_text='before', new_text='after')))
        self.assertEqual(compile_text_patch(self.edit(old_text='before\n\n', new_text='after\n\n')),
            '*** Begin Patch\n*** Update File: package/solution.py\n@@\n'
            '-before\n-\n+after\n+\n*** End Patch\n')
        self.assertIn('native file-ending newline policy', TEXT_PATCH_SCHEMA['description'])

    def test_escaping_or_control_bearing_paths_are_rejected(self):
        for path in ('', '/outside.py', '../outside.py', 'package/../outside.py',
                     'package/../../outside.py', 'package\\outside.py', 'C:/outside.py',
                     'package/line\nbreak.py', 'package/carriage\rreturn.py',
                     'package/tab\tname.py', 'package/nul\x00name.py',
                     'package/control\x1fname.py', 'package/delete\x7fname.py', '\ud800.py'):
            with self.subTest(path=repr(path)):
                with self.assertRaises(ValueError):
                    compile_text_patch(self.edit(path=path))

    def test_wrong_fields_types_or_missing_required_data_are_rejected(self):
        variants = [None, [], 'patch', 1]
        for field in ('path', 'old_text', 'new_text'):
            missing = self.edit(); del missing[field]
            variants.append(missing)
            variants.extend(self.edit(**{field: value}) for value in (None, [], {}, True, 1))
        variants.extend((self.edit(old_text=''), self.edit(workdir='/outside'),
                         self.edit(input='*** Begin Patch'), self.edit(cmd='do_something'),
                         self.edit(sandbox_permissions='require_escalated')))
        for index, edit in enumerate(variants):
            with self.subTest(case=index):
                with self.assertRaises(ValueError):
                    compile_text_patch(edit)

    def test_text_fields_reject_nul_carriage_return_or_unencodable_unicode(self):
        for field in ('old_text', 'new_text'):
            for text in ('before\x00after', 'before\rafter', 'before\r\nafter', '\ud800'):
                with self.subTest(field=field, text=repr(text)):
                    with self.assertRaises(ValueError):
                        compile_text_patch(self.edit(**{field: text}))

    def test_text_limits_count_utf8_bytes_for_each_field(self):
        old = 'é' * 16384
        new = 'ø' * 16384
        patch = compile_text_patch(self.edit(old_text=old, new_text=new))
        self.assertEqual(patch,
            '*** Begin Patch\n*** Update File: package/solution.py\n@@\n-'
            + old + '\n+' + new + '\n*** End Patch\n')
        self.assertLessEqual(len(patch.encode('utf-8')), 128 * 1024)
        for field in ('old_text', 'new_text'):
            for text in ('x' * 32769, 'é' * 16384 + 'x'):
                with self.subTest(field=field, bytes=len(text.encode('utf-8'))):
                    with self.assertRaises(ValueError):
                        compile_text_patch(self.edit(**{field: text}))

    def test_emitted_patch_limit_also_bounds_per_line_prefix_expansion(self):
        edit = self.edit(old_text='\n' * 32767 + 'a', new_text='\n' * 32767 + 'b')
        self.assertEqual(len(edit['old_text'].encode('utf-8')), 32768)
        self.assertEqual(len(edit['new_text'].encode('utf-8')), 32768)
        with self.assertRaises(ValueError):
            compile_text_patch(edit)

    def test_compilation_does_not_mutate_edit_data_or_the_published_schema(self):
        schema = deepcopy(TEXT_PATCH_SCHEMA)
        for edit in (self.edit(), self.edit(old_text='')):
            with self.subTest(accepted=bool(edit['old_text'])):
                original = deepcopy(edit)
                if edit['old_text']:
                    compile_text_patch(edit)
                else:
                    with self.assertRaises(ValueError):
                        compile_text_patch(edit)
                self.assertEqual(edit, original)
                self.assertEqual(TEXT_PATCH_SCHEMA, schema)


if __name__ == '__main__':
    unittest.main()
