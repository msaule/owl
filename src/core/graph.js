/**
 * Entity Graph Traversal — finds paths, clusters, and hidden connections
 * in the relationship graph.
 *
 * This enables OWL to discover things like: "Alice → knows → Bob → works-at →
 * Acme Corp → client-of → Your Company" — a 3-hop path that connects
 * a contact to a business relationship.
 */

/**
 * Build an adjacency list from the world model's relationship data.
 * Returns a Map<entityId, Array<{ target, type, strength }>>
 */
export function buildAdjacencyList(worldModel) {
  const graph = new Map();
  const allEntities = worldModel.getChangedEntities(new Date(0).toISOString(), 10000);

  for (const entity of allEntities) {
    if (!graph.has(entity.id)) {
      graph.set(entity.id, []);
    }
  }

  for (const entity of allEntities) {
    const relationships = worldModel.getRelationships(entity.id);
    for (const rel of relationships) {
      const from = rel.from_entity;
      const to = rel.to_entity;

      if (!graph.has(from)) graph.set(from, []);
      if (!graph.has(to)) graph.set(to, []);

      graph.get(from).push({ target: to, type: rel.type, strength: rel.strength });
      graph.get(to).push({ target: from, type: rel.type, strength: rel.strength });
    }
  }

  return graph;
}

/**
 * BFS shortest path between two entities.
 * Returns the path as an array of { entity, relationship } steps, or null.
 */
export function findPath(graph, startId, endId, maxHops = 5) {
  if (startId === endId) return [];
  if (!graph.has(startId) || !graph.has(endId)) return null;

  const visited = new Set([startId]);
  const queue = [[{ entity: startId, via: null }]];

  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1].entity;

    if (path.length > maxHops + 1) continue;

    for (const edge of (graph.get(current) || [])) {
      if (visited.has(edge.target)) continue;
      visited.add(edge.target);

      const newPath = [...path, { entity: edge.target, via: edge.type }];

      if (edge.target === endId) {
        return newPath;
      }

      queue.push(newPath);
    }
  }

  return null;
}

/**
 * Find clusters of strongly connected entities (communities).
 * Uses a simple label-propagation approach.
 * Returns Map<clusterId, Set<entityId>>
 */
export function findClusters(graph, minStrength = 0.3) {
  const labels = new Map();
  let labelCounter = 0;

  for (const [node] of graph) {
    labels.set(node, labelCounter++);
  }

  // Run label propagation for a fixed number of iterations
  for (let iteration = 0; iteration < 10; iteration++) {
    let changed = false;
    const nodes = [...graph.keys()];

    for (const node of nodes) {
      const neighborLabels = {};
      for (const edge of (graph.get(node) || [])) {
        if (edge.strength < minStrength) continue;
        const neighborLabel = labels.get(edge.target);
        if (neighborLabel != null) {
          neighborLabels[neighborLabel] = (neighborLabels[neighborLabel] || 0) + edge.strength;
        }
      }

      if (Object.keys(neighborLabels).length === 0) continue;

      const bestLabel = Number(
        Object.entries(neighborLabels).sort((a, b) => b[1] - a[1])[0][0]
      );

      if (bestLabel !== labels.get(node)) {
        labels.set(node, bestLabel);
        changed = true;
      }
    }

    if (!changed) break;
  }

  // Group by label
  const clusters = new Map();
  for (const [node, label] of labels) {
    if (!clusters.has(label)) clusters.set(label, new Set());
    clusters.get(label).add(node);
  }

  // Filter out singleton clusters
  for (const [label, members] of clusters) {
    if (members.size < 2) {
      clusters.delete(label);
    }
  }

  return clusters;
}

/**
 * Find bridge entities — nodes that connect different clusters.
 * These are high-value entities that sit at the intersection of communities.
 */
export function findBridgeEntities(graph, clusters) {
  const entityToCluster = new Map();
  for (const [label, members] of clusters) {
    for (const entityId of members) {
      entityToCluster.set(entityId, label);
    }
  }

  const bridges = [];
  for (const [node, edges] of graph) {
    const nodeCluster = entityToCluster.get(node);
    if (nodeCluster == null) continue;

    const crossClusterEdges = edges.filter(
      (e) => entityToCluster.has(e.target) && entityToCluster.get(e.target) !== nodeCluster
    );

    if (crossClusterEdges.length > 0) {
      bridges.push({
        entityId: node,
        cluster: nodeCluster,
        crossConnections: crossClusterEdges.length,
        connectedClusters: [...new Set(crossClusterEdges.map((e) => entityToCluster.get(e.target)))]
      });
    }
  }

  return bridges.sort((a, b) => b.crossConnections - a.crossConnections);
}

/**
 * Get the most connected entities (by degree).
 */
export function getHubs(graph, topN = 10) {
  return [...graph.entries()]
    .map(([entityId, edges]) => ({
      entityId,
      degree: edges.length,
      avgStrength: edges.length > 0
        ? edges.reduce((sum, e) => sum + e.strength, 0) / edges.length
        : 0
    }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, topN);
}
