/**
 * Modelos 3D del barrio (desktop/public/empresa/, packs CC0 de Kenney — ver su LEEME.md).
 * Cada modelo se descarga una vez y se clona; los personajes se clonan con su esqueleto para
 * que cada uno anime por su cuenta.
 *
 * Al clonar, el modelo queda «parado» en el origen: centro de su huella en x/z y la base en
 * y = 0. Así colocar un mueble es decir dónde va su centro, sin conocer el pivote de cada pack.
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as clonarEsqueleto } from "three/examples/jsm/utils/SkeletonUtils.js";

const BASE = `${import.meta.env.BASE_URL}empresa/`;
const cargador = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();
let fallidas = 0;
/** Cuántos modelos no cargaron (el panel avisa: un barrio sin muebles no puede pasar en silencio). */
export function cargasFallidas(): number {
  return fallidas;
}

export function cargar(ruta: string): Promise<GLTF> {
  let p = cache.get(ruta);
  if (!p) {
    // Kenney viene en .glb; KayKit en .gltf (+ .bin + textura al lado): la ruta puede traer extensión.
    const archivo = /\.(gltf|glb)$/.test(ruta) ? ruta : `${ruta}.glb`;
    p = cargador.loadAsync(`${BASE}${archivo}`).catch((e) => {
      fallidas++;
      cache.delete(ruta); // que un reintento (otra visita al panel) vuelva a pedirlo
      throw e;
    }).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
      });
      return g;
    });
    cache.set(ruta, p);
  }
  return p;
}

/** Igual que `objeto`, pero escalado para que mida `alto` (KayKit y Kenney no comparten escala). */
export async function objetoAlto(ruta: string, alto: number): Promise<THREE.Object3D> {
  const o = await objeto(ruta, 1);
  const h = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).y || 1;
  o.scale.setScalar(alto / h);
  return o;
}

/** Un mueble, casa, carro o planta, centrado y sobre el piso. `s` = escala extra. */
export async function objeto(ruta: string, s = 1): Promise<THREE.Object3D> {
  const g = await cargar(ruta);
  const copia = g.scene.clone(true);
  return parar(copia, s);
}

function parar(o: THREE.Object3D, s: number): THREE.Object3D {
  const caja = new THREE.Box3().setFromObject(o);
  const c = caja.getCenter(new THREE.Vector3());
  const envoltura = new THREE.Group();
  o.position.set(-c.x, -caja.min.y, -c.z);
  envoltura.add(o);
  envoltura.scale.setScalar(s);
  return envoltura;
}

export interface Personaje {
  raiz: THREE.Group;
  mixer: THREE.AnimationMixer;
  acciones: Map<string, THREE.AnimationAction>;
  actual: string;
}

/** Altura de un personaje en el mundo (un poco más grandes que en la realidad: se leen mejor). */
const ALTURA_PERSONAJE = 1.2;

export async function personaje(avatar: string): Promise<Personaje> {
  const g = await cargar(`personajes/${avatar}`);
  const copia = clonarEsqueleto(g.scene) as THREE.Group;
  // Los Mini Characters miden ~0,78 de alto en su pose de reposo.
  const raiz = new THREE.Group();
  copia.scale.setScalar(ALTURA_PERSONAJE / 0.78);
  raiz.add(copia);
  const mixer = new THREE.AnimationMixer(copia);
  const acciones = new Map<string, THREE.AnimationAction>();
  for (const clip of g.animations) acciones.set(clip.name, mixer.clipAction(clip));
  const p: Personaje = { raiz, mixer, acciones, actual: "" };
  animar(p, "idle");
  return p;
}

/** Cambia de animación con un fundido corto. */
export function animar(p: Personaje, nombre: string) {
  if (p.actual === nombre) return;
  const nueva = p.acciones.get(nombre) ?? p.acciones.get("idle");
  if (!nueva) return;
  const vieja = p.acciones.get(p.actual);
  nueva.reset().setEffectiveWeight(1).fadeIn(0.25).play();
  if (nombre === "pick-up" || nombre === "emote-yes") nueva.setLoop(THREE.LoopRepeat, Infinity);
  vieja?.fadeOut(0.25);
  p.actual = nombre;
}

/** Gafas o gafas de sol pegadas al hueso de la cabeza: siguen la animación. La altura de los
 *  ojos se calcula con la malla de la cabeza (los accesorios vienen centrados en su origen). */
export async function ponerAccesorio(p: Personaje, accesorio: string) {
  const cabeza = p.raiz.getObjectByName("head");
  const mallaCabeza = p.raiz.getObjectByName("head-mesh") as THREE.Mesh | undefined;
  if (!cabeza) return;
  const g = await cargar(`personajes/${accesorio}`);
  const acc = g.scene.clone(true);
  p.raiz.updateMatrixWorld(true);
  let ojos = new THREE.Vector3(0, 0.28, 0.17);
  if (mallaCabeza?.geometry) {
    mallaCabeza.geometry.computeBoundingBox();
    const bb = mallaCabeza.geometry.boundingBox!;
    // En el espacio del modelo: a media altura de la cabeza, en la cara.
    const enModelo = new THREE.Vector3(0, bb.min.y + (bb.max.y - bb.min.y) * 0.42, bb.max.z - 0.02);
    const mundo = enModelo.applyMatrix4((mallaCabeza.parent ?? mallaCabeza).matrixWorld);
    ojos = cabeza.worldToLocal(mundo);
  }
  acc.position.copy(ojos);
  // El hueso hereda la escala del modelo: el accesorio va en su tamaño original.
  cabeza.add(acc);
}
