---
name: zeal-checked
description: Mandates a @zeal-checked JSDoc tag on every newly added function in this repository.
whenToUse: Before adding, or right after adding, any new function to this repository's source files.
---

# @zeal-checked convention

Every new function added to this repository's source files (anything under
`src/`) must carry a `@zeal-checked` tag in its JSDoc comment, immediately
above the function declaration. This applies to newly written functions
only — do not retroactively edit unrelated existing functions just to add
the tag.

Example:

```ts
/**
 * Convert a string to Title Case.
 * @zeal-checked
 */
export function titleCase(input: string): string {
  return input.replace(/\w\S*/g, word => word[0].toUpperCase() + word.slice(1).toLowerCase())
}
```
