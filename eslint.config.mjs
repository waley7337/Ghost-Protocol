import js from '@eslint/js';
import globals from 'globals';

export default [{
  files: ['electron/**/*.cjs'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs',
    globals: globals.node
  },
  ...js.configs.recommended
}];
