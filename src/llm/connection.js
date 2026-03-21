import { appendNdjson, readNdjson } from '../utils/fs.js';
import { nowIso, sleep } from '../utils/time.js';

function ensureTrailingSlashless(url) {
  return String(url || '').replace(/\/+$/, '');
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function extractTextFromAnthropic(response) {
  return response?.content?.map((item) => item.text || '').join('\n').trim() || '';
}

function extractTextFromOpenAi(response) {
  const message = response?.choices?.[0]?.message;
  if (!message) {
    return '';
  }

  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content.map((item) => item.text || item?.content || '').join('\n').trim();
  }

  return '';
}

export class LLMConnection {
  constructor(config = {}, options = {}) {
    this.provider = config.provider || 'openai-compatible';
    this.baseUrl = ensureTrailingSlashless(config.baseUrl || 'http://localhost:11434/v1');
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'qwen2.5:14b-instruct';
    this.detailLevel = config.detailLevel || 'standard';
    this.pricing = config.pricing || { inputPer1k: 0, outputPer1k: 0 };
    this.costLogPath = options.costLogPath;
    this.logger = options.logger;
  }

  async chat(systemPrompt, userPrompt, options = {}) {
    const retries = options.retries || 3;
    let lastError = null;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const result =
          this.provider === 'anthropic' || this.baseUrl.includes('anthropic.com')
            ? await this.#chatAnthropic(systemPrompt, userPrompt, options)
            : await this.#chatOpenAiCompatible(systemPrompt, userPrompt, options);

        this.#recordUsage(result.usage, systemPrompt, userPrompt, result.text);
        return result.text;
      } catch (error) {
        lastError = error;
        this.logger?.warn('LLM call failed', {
          provider: this.provider,
          model: this.model,
          attempt,
          message: error.message
        });

        if (attempt < retries) {
          await sleep(2 ** attempt * 1000);
        }
      }
    }

    throw lastError || new Error('LLM call failed');
  }

  async testConnection() {
    const response = await this.chat(
      'Reply with JSON only.',
      'Return {"status":"ok","message":"OWL connected"}',
      { responseFormat: 'json', temperature: 0, maxTokens: 120 }
    );

    return response;
  }

  async #chatAnthropic(systemPrompt, userPrompt, options) {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.model,
        system: systemPrompt,
        max_tokens: options.maxTokens || 2000,
        temperature: options.temperature ?? 0.3,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic error ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json();
    return {
      text: extractTextFromAnthropic(payload),
      usage: {
        inputTokens: payload?.usage?.input_tokens ?? estimateTokens(`${systemPrompt}\n${userPrompt}`),
        outputTokens: payload?.usage?.output_tokens ?? estimateTokens(extractTextFromAnthropic(payload))
      }
    };
  }

  async #chatOpenAiCompatible(systemPrompt, userPrompt, options) {
    const body = {
      model: this.model,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens || 2000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    };

    if (options.responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`OpenAI-compatible error ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json();
    const text = extractTextFromOpenAi(payload);

    return {
      text,
      usage: {
        inputTokens: payload?.usage?.prompt_tokens ?? estimateTokens(`${systemPrompt}\n${userPrompt}`),
        outputTokens: payload?.usage?.completion_tokens ?? estimateTokens(text)
      }
    };
  }

  #recordUsage(usage, systemPrompt, userPrompt, outputText) {
    if (!this.costLogPath) {
      return;
    }

    const inputTokens = usage?.inputTokens ?? estimateTokens(`${systemPrompt}\n${userPrompt}`);
    const outputTokens = usage?.outputTokens ?? estimateTokens(outputText);
    const inputCost = (inputTokens / 1000) * (this.pricing.inputPer1k || 0);
    const outputCost = (outputTokens / 1000) * (this.pricing.outputPer1k || 0);

    appendNdjson(this.costLogPath, {
      timestamp: nowIso(),
      provider: this.provider,
      model: this.model,
      inputTokens,
      outputTokens,
      estimatedCost: Number((inputCost + outputCost).toFixed(6))
    });
  }
}

export function summarizeCosts(costLogPath, days = 30) {
  const cutoff = Date.now() - days * 86_400_000;
  const relevant = readNdjson(costLogPath).filter((entry) => new Date(entry.timestamp).getTime() >= cutoff);

  return relevant.reduce(
    (summary, entry) => {
      summary.calls += 1;
      summary.inputTokens += entry.inputTokens || 0;
      summary.outputTokens += entry.outputTokens || 0;
      summary.estimatedCost += entry.estimatedCost || 0;
      return summary;
    },
    { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 }
  );
}
