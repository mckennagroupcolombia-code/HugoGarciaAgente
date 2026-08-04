/**
 * Layout tipo cladograma para el grafo de commits (panel Control de Versiones).
 * Sin librerias externas: asigna cada commit a un "carril" (lane) recorriendo
 * el historial de mas reciente a mas antiguo (mismo orden que `git log`),
 * igual que hacen gitk / GitHub network graph.
 */

export interface GraphCommit {
  hash: string;
  hash_corto: string;
  parents: string[];
  autor: string;
  email: string;
  fecha: string;
  asunto: string;
  refs: string[];
}

export interface LaidOutCommit extends GraphCommit {
  lane: number;
  row: number;
}

export interface GraphEdge {
  fromHash: string;
  toHash: string;
  fromLane: number;
  fromRow: number;
  toLane: number;
  toRow: number;
}

export interface GitGraphLayout {
  nodes: LaidOutCommit[];
  edges: GraphEdge[];
  laneCount: number;
}

/** Cantidad de colores validados del slot categorico (ver skill dataviz). */
export const GIT_LANE_COLOR_COUNT = 8;

export function layoutCommitGraph(commits: GraphCommit[]): GitGraphLayout {
  // lanes[i] = hash del commit que se espera encontrar en ese carril (o null si esta libre)
  const lanes: (string | null)[] = [];
  const posPorHash = new Map<string, { lane: number; row: number }>();
  const nodes: LaidOutCommit[] = [];

  commits.forEach((c, row) => {
    let laneIdx = lanes.indexOf(c.hash);
    if (laneIdx === -1) laneIdx = lanes.indexOf(null);
    if (laneIdx === -1) {
      laneIdx = lanes.length;
      lanes.push(null);
    }

    posPorHash.set(c.hash, { lane: laneIdx, row });
    nodes.push({ ...c, lane: laneIdx, row });

    const [primerPadre, ...resto] = c.parents;
    lanes[laneIdx] = primerPadre ?? null;

    for (const p of resto) {
      if (lanes.includes(p)) continue;
      let libre = lanes.indexOf(null);
      if (libre === -1) {
        libre = lanes.length;
        lanes.push(p);
      } else {
        lanes[libre] = p;
      }
    }
  });

  const edges: GraphEdge[] = [];
  for (const n of nodes) {
    for (const padreHash of n.parents) {
      const destino = posPorHash.get(padreHash);
      if (!destino) continue; // padre fuera del limite cargado — sin arista
      edges.push({
        fromHash: n.hash,
        toHash: padreHash,
        fromLane: n.lane,
        fromRow: n.row,
        toLane: destino.lane,
        toRow: destino.row,
      });
    }
  }

  return { nodes, edges, laneCount: lanes.length };
}
