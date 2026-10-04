import type { Config } from "tailwindcss";

export default {
  // `components/` was missing from this list, so every Tailwind class used in
  // the client components was never generated. The pages still rendered, which
  // is what made it hard to see: utilities that also appear under app/ were
  // present by coincidence, and everything unique to a component silently fell
  // back to no styling. A responsive layout there collapsed to a column and the
  // button dropped below the field it was supposed to sit beside.
  content: [
    "./app/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
