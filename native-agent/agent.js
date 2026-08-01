  getContextUsage(realUsage) {
    const contextWindow = this._contextWindow || DEFAULT_CONTEXT_WINDOW;

    // Prefer real usage from the API response.
    // totalTokens is cumulative across all turns = actual context consumption.
    if (realUsage) {
      // totalTokens is the most reliable metric — it's the cumulative total
      if (typeof realUsage.totalTokens === 'number' && realUsage.totalTokens > 0) {
        const usagePct = contextWindow > 0 ? Math.min(100, (realUsage.totalTokens / contextWindow) * 100) : 0;
        return { usagePct, promptTokens: realUsage.totalTokens, contextWindow };
      }
      // Fallback: input + output of last turn (less accurate but better than nothing)
      const lastTurnTokens = (realUsage.input || 0) + (realUsage.output || 0);
      if (lastTurnTokens > 0) {
        const usagePct = contextWindow > 0 ? Math.min(100, (lastTurnTokens / contextWindow) * 100) : 0;
        return { usagePct, promptTokens: lastTurnTokens, contextWindow };
      }
    }

    // Fallback: estimate from messages + system prompt
    let totalTokens = 0;
    if (this._systemPrompt) {
      totalTokens += Math.ceil(this._systemPrompt.length / CHARS_PER_TOKEN);
    }
    if (this._piAgent) {
      const msgs = this._piAgent.state.messages;
      for (const m of msgs) {
        totalTokens += estimateMessageTokens(m);
      }
    }
    const usagePct = contextWindow > 0 ? Math.min(100, (totalTokens / contextWindow) * 100) : 0;
    return { usagePct, promptTokens: totalTokens, contextWindow };
  }
