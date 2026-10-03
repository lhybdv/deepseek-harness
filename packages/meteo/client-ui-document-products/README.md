# Meteorological document product panel

English | [中文](README.zh.md)

Load its host half so the browser modules loader discovers the declared client face:

```yaml
- id: ui-meteo-document-products
  name: '@deepseek-ai/dsh-client-ui-document-products'
```

The client export `@deepseek-ai/dsh-client-ui-document-products/client` registers its panel in `sidebar.panellist` and its keyed `main` body. It mounts the generated `@deepseek-ai/dsh-api-document-products` Remote face, lists products for the selected session, generates a draft, applies legal lifecycle actions, and refreshes after every operation. Pending and error states remain visible; all interface copy is owned by the `meteo-document-products` locale namespace.
