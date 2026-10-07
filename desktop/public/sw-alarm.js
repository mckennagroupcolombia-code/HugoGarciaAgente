// Service Worker — alarma de tareas McKenna
// Dos canales de notificación:
//   1. message("alarm-notification")  → app en background, pantalla encendida
//   2. push event (VAPID server push) → pantalla bloqueada / Chrome suspendido
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

function mostrarNotificacion(reg) {
  return reg.showNotification("⏱ McKenna — Acción en progreso", {
    body: "Tienes una tarea activa. Toca para revisar el avance.",
    icon: "/app/icon-512.png",
    badge: "/app/icon-192.png",
    tag: "tarea-alarma",
    renotify: true,
    // requireInteraction: true mantiene la notificación en pantalla hasta que
    // el usuario la toque — ideal para no perder el aviso con pantalla bloqueada.
    requireInteraction: true,
    silent: false,
    vibrate: [200, 100, 200, 100, 400],
    actions: [
      { action: "abrir", title: "Ver tarea" },
    ],
  });
}

// Canal 1: mensaje desde la página (pantalla encendida, app en background)
self.addEventListener("message", (event) => {
  if (event.data?.type !== "alarm-notification") return;
  event.waitUntil(mostrarNotificacion(self.registration));
});

// Mensaje nuevo en un grupo del equipo (app/services/canales_avisos.py). Si la app está
// a la vista, la página ya lo muestra con su propia tarjeta y sonido: no se duplica.
function mostrarMensajeChat(data) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const visible = clients.some((c) => c.visibilityState === "visible" && c.focused);
    if (visible) return undefined;
    return self.registration.showNotification(data.titulo || "Mensaje nuevo del equipo", {
      body: data.cuerpo || "",
      icon: "/app/icon-512.png",
      badge: "/app/icon-192.png",
      tag: data.tag || "chat-mensaje",
      renotify: true,
      silent: false,
      vibrate: [120, 60, 120],
      data: { canal_id: data.canal_id || null },
    });
  });
}

// Canal 2: push del servidor (pantalla bloqueada / Chrome suspendido)
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { /* payload vacío: disparar igual */ }
  if (data.type === "chat-mensaje") {
    event.waitUntil(mostrarMensajeChat(data));
    return;
  }
  if (data.type && data.type !== "alarm-notification") return;
  event.waitUntil(mostrarNotificacion(self.registration));
});

// Clic o acción en la notificación → enfocar o abrir la app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Tanto el clic general como la acción "abrir" llevan a la app
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const app = clients.find((c) => c.url.includes("/app"));
        if (app) return app.focus();
        return self.clients.openWindow("/app");
      })
  );
});
