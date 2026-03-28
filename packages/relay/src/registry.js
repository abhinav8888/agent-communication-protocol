export class Registry {
  constructor() {
    this.agents = new Map();       // name -> { card, ws, secret }
    this.connectionMap = new Map(); // ws -> name
  }

  register(card, ws, secret) {
    if (this.agents.has(card.name)) {
      // Replace stale connection on reconnection
      const existing = this.agents.get(card.name);
      if (existing.ws !== ws) {
        if (existing.ws.readyState <= 1) existing.ws.close(1001, 'Replaced by reconnection');
        this.connectionMap.delete(existing.ws);
      }
      this.agents.delete(card.name);
    }
    const connectedAgents = [...this.agents.keys()];
    this.agents.set(card.name, { card, ws, secret });
    this.connectionMap.set(ws, card.name);
    return { registered: true, agentName: card.name, connectedAgents };
  }

  unregister(name) {
    const entry = this.agents.get(name);
    if (entry) { this.connectionMap.delete(entry.ws); this.agents.delete(name); }
  }

  listAgents(excludeName) {
    const result = [];
    for (const [name, { card }] of this.agents) {
      if (name === excludeName) continue;
      result.push({ name: card.name, description: card.description, skills: card.skills, metadata: card.metadata });
    }
    return result;
  }

  discoverByTag(tag) {
    const result = [];
    for (const [, { card }] of this.agents) {
      const matchingSkills = card.skills.filter(s => s.tags && s.tags.includes(tag));
      if (matchingSkills.length > 0) result.push({ name: card.name, description: card.description, matchingSkills });
    }
    return result;
  }

  getConnection(name) { return this.agents.get(name)?.ws ?? null; }
  getSecret(name) { return this.agents.get(name)?.secret ?? null; }
  getNameByConnection(ws) { return this.connectionMap.get(ws) ?? null; }

  getAllConnectionsExcept(excludeName) {
    const result = [];
    for (const [name, { ws }] of this.agents) { if (name !== excludeName) result.push({ name, ws }); }
    return result;
  }
}
