# pont README

一、安装

1、打开 vscode。扩展中搜索 pont。安装并点击重新加载。

2、项目中要包含 pont-config.json 。配置如下：

```json
{
  // 配置代码模板
  "templatePath": "./template",
  "outDir": "../src/services",
  // 数据源
  "originUrl": "http://your-service-hostname/v2/api-docs",
  // 配置代码风格
  "prettierConfig": {
    "printWidth": 120,
    "singleQuote": true,
    "trailingComma": "none",
    "jsxBracketSameLine": true
  }
}
```

代码模板：template.ts

```typescript
```

二、使用

请参看 [pont](https://github.com/nefe/pont)
