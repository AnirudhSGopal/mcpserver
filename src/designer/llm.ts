import 'dotenv/config';

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmCompletionResult {
  content: string;
  usage: LlmUsage;
  isRealLlm: boolean;
  model: string;
}

export async function callLlmStructured(params: {
  systemPrompt: string;
  userPrompt: string;
  testMode?: boolean;
  mockResponseGenerator?: () => string;
}): Promise<LlmCompletionResult> {
  const requireRealLlm = process.env.REQUIRE_REAL_LLM === '1';
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  const hasAnyKey = Boolean(anthropicKey || openaiKey || geminiKey);

  // If REQUIRE_REAL_LLM=1 and no key or testMode requested, throw immediately
  if (requireRealLlm) {
    if (params.testMode) {
      throw new Error('REQUIRE_REAL_LLM=1 is enabled: Test mode / mock fallback is strictly forbidden.');
    }
    if (!hasAnyKey) {
      throw new Error(
        'REQUIRE_REAL_LLM=1 is enabled, but none of ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY are configured in the environment.'
      );
    }
  }

  // Model ID read ONLY from env - no hardcoded old IDs
  const modelId = process.env.MODEL_ID;

  // Real LLM call if API key exists and not in explicit testMode
  if (!params.testMode && hasAnyKey) {
    if (!modelId) {
      throw new Error('MODEL_ID environment variable is required when invoking real LLM.');
    }

    if (anthropicKey) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 4096,
          system: params.systemPrompt,
          messages: [{ role: 'user', content: params.userPrompt }]
        })
      });

      if (!res.ok) {
        throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);
      }

      const data = await res.json();
      return {
        content: data.content[0].text,
        usage: {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: data.usage.input_tokens + data.usage.output_tokens
        },
        isRealLlm: true,
        model: modelId
      };
    }

    if (geminiKey) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: `${params.systemPrompt}\n\n${params.userPrompt}` }]
              }
            ]
          })
        }
      );
      if (!res.ok) {
        throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return {
        content: text,
        usage: {
          promptTokens: data.usageMetadata?.promptTokenCount || 0,
          completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: data.usageMetadata?.totalTokenCount || 0
        },
        isRealLlm: true,
        model: modelId
      };
    }
  }

  // Explicit test mode / fallback stub with realistic token accounting
  const approxPromptTokens = Math.ceil((params.systemPrompt.length + params.userPrompt.length) / 4);
  const content = params.mockResponseGenerator ? params.mockResponseGenerator() : '[]';
  const approxCompletionTokens = Math.ceil(content.length / 4);

  return {
    content,
    usage: {
      promptTokens: approxPromptTokens,
      completionTokens: approxCompletionTokens,
      totalTokens: approxPromptTokens + approxCompletionTokens
    },
    isRealLlm: false,
    model: modelId ? `${modelId} (test-mode)` : 'stub (test-mode)'
  };
}
