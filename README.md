# 🧩 React Dev Snippets and boilerplate file generation

A collection of productivity-boosting VS Code snippets:

- `react-hook-form`
- `react-query`
- `yup`
- Custom UI builders (like `FormBuilder`)

## ✨ Snippets Included

| Prefix  | Description                          |
| ------- | ------------------------------------ |
| `frm`   | React Hook Form setup with yup       |
| `qr`    | React Query with custom options      |
| `fb`    | FormBuilder field boilerplate        |
| `memo`  | `useMemo` declaration                |
| `watch` | `useWatch` hook from react-hook-form |

## 🚀 Usage

In any `.tsx` or `.ts` file, type the prefix and hit `Tab`.

Example:  
Typing `frm` expands to:

```ts
const { control, handleSubmit } = useForm<Type>({
  defaultValues: {
    // ...
  },
  resolver: yupResolver(schema),
});
```
