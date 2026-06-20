import { Button } from "../../components/button/Button.tsx";

interface LoginProps {
  heading?: string;
}

// A page composition: a heading plus two <Button>s. In isolate this becomes a
// /pages/ route whose controls panel has a group per component on the page.
export default function Login({ heading = "Welcome back" }: LoginProps) {
  return (
    <div class="flex flex-col items-center gap-5 p-10">
      <h1 class="text-2xl font-bold">{heading}</h1>
      <input
        id="email"
        type="email"
        placeholder="you@example.com"
        class="px-3 py-1.5 border-2 border-gray-400 rounded-sm"
      />
      <div class="flex gap-3">
        <Button id="submit">Sign in</Button>
        <Button id="cancel">Cancel</Button>
      </div>
    </div>
  );
}
