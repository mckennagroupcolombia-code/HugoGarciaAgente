import { useState, useRef, useEffect, type FormEvent } from "react";
import { useChatMutation } from "../hooks/useChat";

interface Message {
  role: "user" | "agent";
  text: string;
  time: string;
}

const SESSION_ID = "panel_react_" + Math.random().toString(36).slice(2, 10);

function formatTime(d: Date) {
  return d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chat = useChatMutation();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || chat.isPending) return;

    const now = new Date();
    setMessages((m) => [...m, { role: "user", text, time: formatTime(now) }]);
    setInput("");

    chat.mutate(
      { mensaje: text, session_id: SESSION_ID },
      {
        onSuccess: (data) => {
          setMessages((m) => [
            ...m,
            { role: "agent", text: data.respuesta, time: formatTime(new Date()) },
          ]);
        },
        onError: (err) => {
          setMessages((m) => [
            ...m,
            { role: "agent", text: `Error: ${err.message}`, time: formatTime(new Date()) },
          ]);
        },
      },
    );

    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <h2 className="mb-4 text-lg font-semibold text-ink">Chat con Hugo Garcia</h2>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-auto rounded-paper-lg border border-border bg-surface-panel p-4 shadow-paper-sm">
        {messages.length === 0 && (
          <p className="py-12 text-center text-sm text-muted">
            Escribe un mensaje para comenzar la conversacion con Hugo Garcia.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user"
                  ? "rounded-br-md bg-accent text-white"
                  : "rounded-bl-md bg-surface-hover text-ink"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.text}</p>
              <p className={`mt-1 text-[10px] ${m.role === "user" ? "text-white/60" : "text-muted"}`}>
                {m.time}
              </p>
            </div>
          </div>
        ))}
        {chat.isPending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-surface-hover px-4 py-3">
              <div className="flex gap-1.5">
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:0ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:150ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <form onSubmit={send} className="mt-3 flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribe tu mensaje..."
          rows={1}
          className="flex-1 resize-none rounded-xl border border-border bg-surface-input px-4 py-3 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
        />
        <button
          type="submit"
          disabled={!input.trim() || chat.isPending}
          className="rounded-full bg-accent px-6 py-3 text-sm font-bold text-white shadow-[0_3px_0_rgba(0,0,0,0.15)] transition hover:-translate-y-px hover:bg-accent-hover disabled:opacity-40 disabled:hover:translate-y-0"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
