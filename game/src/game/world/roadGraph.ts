/** Pure road-network data (no Three.js, no physics): usable by the mesher, colliders, AI and tests. */
export type RoadKind = 'arterial' | 'street';

export interface RoadNode {
  id: number;
  x: number;
  z: number;
}

export interface RoadEdge {
  id: number;
  a: number;
  b: number;
  kind: RoadKind;
  /** Road surface width in metres. */
  width: number;
  length: number;
  /** true when the road runs along the X axis (constant z). */
  alongX: boolean;
}

export class RoadGraph {
  readonly nodes: RoadNode[] = [];
  readonly edges: RoadEdge[] = [];
  private adjacency: number[][] = [];

  addNode(x: number, z: number): number {
    const id = this.nodes.length;
    this.nodes.push({ id, x, z });
    this.adjacency.push([]);
    return id;
  }

  /** Adds an axis-aligned road between two nodes. Throws if they are not aligned. */
  addEdge(a: number, b: number, kind: RoadKind, width: number): RoadEdge {
    const na = this.node(a);
    const nb = this.node(b);
    const alongX = Math.abs(na.z - nb.z) < 1e-6;
    if (!alongX && Math.abs(na.x - nb.x) > 1e-6) throw new Error('RoadGraph: edges must be axis-aligned');
    const edge: RoadEdge = {
      id: this.edges.length,
      a,
      b,
      kind,
      width,
      length: Math.hypot(na.x - nb.x, na.z - nb.z),
      alongX,
    };
    this.edges.push(edge);
    this.adjacency[a]!.push(edge.id);
    this.adjacency[b]!.push(edge.id);
    return edge;
  }

  node(id: number): RoadNode {
    const n = this.nodes[id];
    if (!n) throw new Error(`RoadGraph: no node ${id}`);
    return n;
  }

  /** Edge ids touching a node. */
  edgesOf(node: number): readonly number[] {
    return this.adjacency[node] ?? [];
  }

  neighbours(node: number): number[] {
    return this.edgesOf(node).map((e) => {
      const edge = this.edges[e]!;
      return edge.a === node ? edge.b : edge.a;
    });
  }

  /** Widest road meeting at a node (sizes the intersection patch). */
  junctionWidth(node: number): number {
    let w = 0;
    for (const e of this.edgesOf(node)) w = Math.max(w, this.edges[e]!.width);
    return w;
  }

  /** Number of connected components (1 means every road can be driven to every other). */
  componentCount(): number {
    const seen = new Array<boolean>(this.nodes.length).fill(false);
    let count = 0;
    for (const n of this.nodes) {
      if (seen[n.id]) continue;
      count++;
      const stack = [n.id];
      seen[n.id] = true;
      while (stack.length) {
        const cur = stack.pop()!;
        for (const nb of this.neighbours(cur)) {
          if (!seen[nb]) {
            seen[nb] = true;
            stack.push(nb);
          }
        }
      }
    }
    return count;
  }

  isConnected(): boolean {
    return this.nodes.length > 0 && this.componentCount() === 1;
  }

  /** Nearest node to a point (for spawning and AI). */
  nearestNode(x: number, z: number): RoadNode {
    let best: RoadNode | null = null;
    let bestD = Infinity;
    for (const n of this.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (!best) throw new Error('RoadGraph: empty');
    return best;
  }
}
