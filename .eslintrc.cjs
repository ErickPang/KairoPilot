module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // === 工程化加强规则（当前 off，后续逐步开启） ===
    // 禁止 console.log 调用（保留 error/warn）
    'no-console': 'off',
    // 禁止超过 3 层相对路径导入
    'no-restricted-imports': 'off',
    // 未使用变量允许 _ 前缀参数
    '@typescript-eslint/no-unused-vars': ['error', {
      'argsIgnorePattern': '^_',
      'varsIgnorePattern': '^_',
    }],
  },
}
