/**
 * El «look» del juego (referencia: FarmVille 3): lo que hace que un barrio de cajas se vea
 * como un juego y no como un plano.
 *
 * - Cámara en perspectiva de lente larga (≈30°), inclinada ~52°: profundidad sin deformar.
 * - Luz de tarde: sol cálido con sombras suaves + cielo azul que rellena; bruma a lo lejos.
 * - Postproceso: oclusión ambiental (GTAO: contacto y volumen), un poco de brillo (bloom),
 *   saturación y antialias (SMAA).
 * - Suelo vivo: pasto en textura con variación, miles de matas que se mecen con el viento
 *   (en la GPU) y margaritas; caminos de tierra con borde irregular.
 *
 * Calidad: «alta» (todo), «media» (sin GTAO) o «baja» (sin postproceso, menos pasto, sombras
 * más chicas). El celular arranca en «media» o «baja».
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { HueSaturationShader } from "three/examples/jsm/shaders/HueSaturationShader.js";

export type Calidad = "alta" | "media" | "baja";
export type Rect = { x0: number; z0: number; x1: number; z1: number };

export function calidadInicial(): Calidad {
  try {
    const g = localStorage.getItem("mck-empresa-calidad");
    if (g === "alta" || g === "media" || g === "baja") return g;
  } catch { /* sin almacenamiento */ }
  const movil = window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth < 700;
  const nucleos = navigator.hardwareConcurrency || 4;
  return movil ? (nucleos >= 8 ? "media" : "baja") : "alta";
}

export class Ambiente {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camara: THREE.PerspectiveCamera;
  readonly sol: THREE.DirectionalLight;
  private composer: EffectComposer | null = null;
  private gtao: GTAOPass | null = null;
  private pasto: THREE.InstancedMesh | null = null;
  private uViento = { value: 0 };
  calidad: Calidad;

  constructor(private cont: HTMLElement, calidad: Calidad = calidadInicial()) {
    this.calidad = calidad;
    this.renderer = new THREE.WebGLRenderer({ antialias: calidad === "baja", powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(calidad === "baja" ? 1 : 2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    Object.assign(this.renderer.domElement.style, { display: "block", touchAction: "none" });
    cont.appendChild(this.renderer.domElement);

    this.camara = new THREE.PerspectiveCamera(30, 1, 1, 400);
    this.scene.background = this.cielo();
    this.scene.fog = new THREE.Fog("#CDEBFA", 70, 190);

    this.scene.add(new THREE.HemisphereLight("#D8F1FF", "#6E9A3C", 1.25));
    this.sol = new THREE.DirectionalLight("#FFE3B8", 2.9);
    this.sol.position.set(-30, 55, 26);
    this.sol.castShadow = true;
    const tam = calidad === "baja" ? 1024 : 2048;
    this.sol.shadow.mapSize.set(tam, tam);
    Object.assign(this.sol.shadow.camera, { left: -45, right: 45, top: 34, bottom: -34, near: 5, far: 160 });
    this.sol.shadow.bias = -0.0004;
    this.sol.shadow.normalBias = 0.03;
    this.sol.shadow.radius = 3;
    this.scene.add(this.sol, this.sol.target);
    this.armarPostproceso();
  }

  /** Cielo con degradado (arriba azul, horizonte claro): un fondo plano se ve «de oficina». */
  private cielo(): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = 4; c.height = 256;
    const g = c.getContext("2d")!;
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, "#6EC3F2");
    gr.addColorStop(0.6, "#B6E2F8");
    gr.addColorStop(1, "#E8F7FF");
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private armarPostproceso() {
    this.composer?.dispose();
    this.composer = null;
    this.gtao = null;
    if (this.calidad === "baja") return;
    const w = Math.max(1, this.cont.clientWidth), h = Math.max(1, this.cont.clientHeight);
    const comp = new EffectComposer(this.renderer);
    comp.addPass(new RenderPass(this.scene, this.camara));
    if (this.calidad === "alta") {
      const ao = new GTAOPass(this.scene, this.camara, w, h);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.2, scale: 1.1, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      comp.addPass(ao);
      this.gtao = ao;
    }
    comp.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.16, 0.55, 0.9));
    const color = new ShaderPass(HueSaturationShader);
    color.uniforms.saturation.value = 0.16;
    comp.addPass(color);
    comp.addPass(new OutputPass());
    comp.addPass(new SMAAPass());
    this.composer = comp;
    this.ajustar(w, h);
  }

  cambiarCalidad(c: Calidad) {
    if (c === this.calidad) return;
    this.calidad = c;
    try { localStorage.setItem("mck-empresa-calidad", c); } catch { /* sin almacenamiento */ }
    this.renderer.setPixelRatio(Math.min(c === "baja" ? 1 : 2, window.devicePixelRatio || 1));
    this.armarPostproceso();
    if (this.pasto) this.pasto.count = Math.round(this.pasto.instanceMatrix.count * (c === "baja" ? 0.35 : c === "media" ? 0.7 : 1));
  }

  ajustar(w = this.cont.clientWidth, h = this.cont.clientHeight) {
    w = Math.max(1, w); h = Math.max(1, h);
    this.renderer.setSize(w, h, false);
    Object.assign(this.renderer.domElement.style, { width: `${w}px`, height: `${h}px` });
    this.camara.aspect = w / h;
    this.camara.updateProjectionMatrix();
    this.composer?.setSize(w, h);
  }

  render(t: number) {
    this.uViento.value = t;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camara);
  }

  dispose() {
    this.composer?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => {
        (x as THREE.MeshStandardMaterial).map?.dispose();
        x?.dispose();
      });
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ─── Suelo ─────────────────────────────────────────────────────────────────

  /** Pasto de base: textura con manchas de varios verdes (nada de un verde plano). */
  suelo(ancho: number, fondo: number, cx = 0, cz = 0) {
    const n = 512;
    const c = document.createElement("canvas");
    c.width = c.height = n;
    const g = c.getContext("2d")!;
    g.fillStyle = "#79C24B";
    g.fillRect(0, 0, n, n);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const tonos = ["#8ED054", "#6BB242", "#9BDA5E", "#5FA63B", "#84CA4E"];
    for (let i = 0; i < 1400; i++) {
      g.globalAlpha = 0.18 + rnd() * 0.25;
      g.fillStyle = tonos[i % tonos.length];
      g.beginPath();
      g.ellipse(rnd() * n, rnd() * n, 6 + rnd() * 26, 4 + rnd() * 18, rnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(ancho / 14, fondo / 14);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ancho, fondo).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    m.position.set(cx, -0.01, cz);
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  /** Camino de tierra a lo largo de una polilínea, con borde irregular que se funde con el pasto. */
  camino(puntos: { x: number; z: number }[], ancho = 1.6, color = "#D9B07A") {
    const c = document.createElement("canvas");
    c.width = 64; c.height = 256;
    const g = c.getContext("2d")!;
    let s = 3;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < 256; y += 2) {
      const borde = 6 + rnd() * 8;
      const gr = g.createLinearGradient(0, 0, 64, 0);
      gr.addColorStop(0, "rgba(0,0,0,0)");
      gr.addColorStop(borde / 64, color);
      gr.addColorStop(1 - borde / 64, color);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(0, y, 64, 2);
    }
    for (let i = 0; i < 160; i++) {
      g.fillStyle = rnd() > 0.5 ? "rgba(255,240,210,0.35)" : "rgba(140,90,50,0.25)";
      g.fillRect(10 + rnd() * 44, rnd() * 256, 2 + rnd() * 3, 2 + rnd() * 3);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 1, depthWrite: false,
                                                 polygonOffset: true, polygonOffsetFactor: -2 });
    for (let i = 0; i < puntos.length - 1; i++) {
      const a = puntos[i], b = puntos[i + 1];
      const largo = Math.hypot(b.x - a.x, b.z - a.z) + ancho * 0.6;
      const geo = new THREE.PlaneGeometry(ancho, largo).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      m.position.set((a.x + b.x) / 2, 0.012 + i * 0.0005, (a.z + b.z) / 2);
      m.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      m.receiveShadow = true;
      (m.material as THREE.MeshStandardMaterial).map!.repeat.set(1, largo / 3);
      this.scene.add(m);
    }
  }

  /** Matas de pasto que se mecen con el viento. `excluir` = donde no crece (casas, calles). */
  pastoVivo(area: Rect, cantidad: number, excluir: Rect[] = []) {
    // Una mata = 5 hojas finas cruzadas, más claras en la punta.
    const hojas: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const h = new THREE.PlaneGeometry(0.075, 0.24, 1, 3);
      h.translate(0, 0.12, 0);
      const p = h.attributes.position;
      for (let v = 0; v < p.count; v++) {
        const y = p.getY(v);
        p.setX(v, p.getX(v) * (1 - y / 0.26));   // afilada
        p.setZ(v, p.getZ(v) + (y * y) * 0.6);    // curva hacia afuera
      }
      h.rotateY((i / 5) * Math.PI + (i % 2) * 0.3);
      h.translate(Math.cos(i * 1.7) * 0.05, 0, Math.sin(i * 1.7) * 0.05);
      hojas.push(h);
    }
    const geo = mezclar(hojas);
    const altura = new Float32Array(geo.attributes.position.count);
    for (let v = 0; v < altura.length; v++) altura[v] = geo.attributes.position.getY(v) / 0.26;
    geo.setAttribute("altura", new THREE.BufferAttribute(altura, 1));
    const mat = new THREE.MeshStandardMaterial({ color: "#7FCB4A", roughness: 0.9, side: THREE.DoubleSide });
    const viento = this.uViento;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uViento = viento;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uViento;\nattribute float altura;\nvarying float vAltura;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vAltura = altura;
          vec4 mundo = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float ola = sin(uViento * 1.7 + mundo.x * 0.35 + mundo.z * 0.22) * 0.5 + sin(uViento * 2.9 + mundo.x * 0.9) * 0.25;
          transformed.x += ola * altura * altura * 0.09;
          transformed.z += ola * altura * altura * 0.05;`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vAltura;")
        .replace("vec4 diffuseColor = vec4( diffuse, opacity );",
                 "vec4 diffuseColor = vec4( mix(diffuse * 0.82, diffuse * 1.18 + vec3(0.07, 0.06, 0.0), vAltura), opacity );");
    };
    const malla = new THREE.InstancedMesh(geo, mat, cantidad);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const color = new THREE.Color();
    let s = 17, k = 0, intentos = 0;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    while (k < cantidad && intentos < cantidad * 6) {
      intentos++;
      const x = area.x0 + rnd() * (area.x1 - area.x0), z = area.z0 + rnd() * (area.z1 - area.z0);
      if (excluir.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)) continue;
      p.set(x, 0, z);
      q.setFromEuler(e.set(0, rnd() * Math.PI * 2, 0));
      const t = 0.7 + rnd() * 0.9;
      sc.set(t, t * (0.8 + rnd() * 0.6), t);
      malla.setMatrixAt(k, m.compose(p, q, sc));
      malla.setColorAt(k, color.setHSL(0.23 + rnd() * 0.05, 0.55 + rnd() * 0.15, 0.5 + rnd() * 0.1));
      k++;
    }
    malla.count = Math.round(k * (this.calidad === "baja" ? 0.35 : this.calidad === "media" ? 0.7 : 1));
    malla.receiveShadow = true;
    malla.frustumCulled = false;
    this.scene.add(malla);
    this.pasto = malla;
    return malla;
  }

  /** Margaritas (pétalos blancos y centro amarillo) en grupitos. */
  flores(area: Rect, grupos: number, excluir: Rect[] = [], colores = ["#FFFFFF", "#FFFFFF", "#FFD6E8", "#FFF3A0"]) {
    const petalos = new THREE.CylinderGeometry(0.07, 0.07, 0.012, 8);
    petalos.translate(0, 0.16, 0);
    const centro = new THREE.SphereGeometry(0.03, 6, 4);
    centro.translate(0, 0.175, 0);
    const tallo = new THREE.CylinderGeometry(0.006, 0.006, 0.16, 3);
    tallo.translate(0, 0.08, 0);
    const pinta = (geo: THREE.BufferGeometry, hex: string) => {
      const col = new THREE.Color(hex);
      const arr = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i < arr.length; i += 3) { arr[i] = col.r; arr[i + 1] = col.g; arr[i + 2] = col.b; }
      geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
      return geo;
    };
    const geo = mezclar([pinta(petalos, "#FFFFFF"), pinta(centro, "#FFC21A"), pinta(tallo, "#4E9A2E")]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    const total = grupos * 7;
    const malla = new THREE.InstancedMesh(geo, mat, total);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const color = new THREE.Color();
    let s = 29, k = 0;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let gI = 0; gI < grupos * 3 && k < total; gI++) {
      const gx = area.x0 + rnd() * (area.x1 - area.x0), gz = area.z0 + rnd() * (area.z1 - area.z0);
      if (excluir.some((r) => gx > r.x0 - 0.3 && gx < r.x1 + 0.3 && gz > r.z0 - 0.3 && gz < r.z1 + 0.3)) continue;
      const tono = colores[gI % colores.length];
      for (let i = 0; i < 7 && k < total; i++) {
        p.set(gx + (rnd() - 0.5) * 0.9, 0, gz + (rnd() - 0.5) * 0.9);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
        const t = 0.8 + rnd() * 0.6;
        sc.set(t, t, t);
        malla.setMatrixAt(k, m.compose(p, q, sc));
        malla.setColorAt(k, color.set(tono));
        k++;
      }
    }
    malla.count = k;
    malla.castShadow = true;
    malla.frustumCulled = false;
    this.scene.add(malla);
    return malla;
  }
}

/** Une varias geometrías sin índice en una (posición, normal, uv y color si los hay). */
function mezclar(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const listas = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const nombre of ["position", "normal", "uv", "color"]) {
    if (!listas.every((g) => g.attributes[nombre])) continue;
    const tam = listas[0].attributes[nombre].itemSize;
    const total = listas.reduce((a, g) => a + g.attributes[nombre].count, 0);
    const arr = new Float32Array(total * tam);
    let o = 0;
    for (const g of listas) { arr.set(g.attributes[nombre].array as Float32Array, o); o += g.attributes[nombre].count * tam; }
    out.setAttribute(nombre, new THREE.BufferAttribute(arr, tam));
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
}
