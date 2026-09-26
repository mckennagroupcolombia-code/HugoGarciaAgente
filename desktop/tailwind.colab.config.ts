import base from "./tailwind.config";

/** Tailwind del build de colaboradores: solo escanea lo que ese bundle importa,
 * así el CSS no lleva clases de los demás módulos. */
export default {
  ...base,
  content: ["./colaboradores.html", "./src/colab/**/*.{ts,tsx}", "./src/components/ColaboradoresPanel.tsx",
            "./src/components/colaboradores/**/*.{ts,tsx}", "./src/components/JuegosPanel.tsx"],
};
