"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function authErrorMessage(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }

  if (normalized.includes("email not confirmed")) {
    return "Confirmá el correo antes de iniciar sesión.";
  }

  if (
    normalized.includes("too many requests") ||
    normalized.includes("rate limit")
  ) {
    return "Demasiados intentos. Esperá un momento y volvé a intentar.";
  }

  return "No se pudo iniciar sesión. Revisá los datos e intentá de nuevo.";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setError("Completá el correo y la contraseña.");
      return;
    }

    setPending(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (signInError) {
      setError(authErrorMessage(signInError.message));
      setPending(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <section className="w-full max-w-sm">
        <p className="text-xs tracking-[0.22em] text-zinc-500 uppercase">
          B_Notes
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          Iniciar sesión
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Entrá con el correo y la contraseña de tu cuenta.
        </p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm text-zinc-300">
              Correo
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm outline-none transition focus:border-zinc-500"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm text-zinc-300">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm outline-none transition focus:border-zinc-500"
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm leading-6 text-red-300">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="h-11 w-full rounded-lg bg-zinc-100 text-sm font-medium text-zinc-950 transition hover:bg-white disabled:cursor-wait disabled:opacity-70"
          >
            {pending ? "Ingresando…" : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
