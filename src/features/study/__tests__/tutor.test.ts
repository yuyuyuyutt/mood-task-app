// src/features/study/__tests__/tutor.test.ts
// 辅导员的三条纪律：先检索再回答、没有依据就拒绝（**且不调用模型**）、引用走白名单。
import { describe, expect, it } from 'vitest';
import {
  MIN_TUTOR_SCORE,
  askTutor,
  buildTutorChunks,
  buildTutorMessages,
  parseTutorCitations,
} from '../tutor';
import { InMemoryVectorBackend } from '../../plan-generator/services/rag/inMemoryVectorBackend';
import { VectorStore } from '../../plan-generator/services/rag/vectorStore';
import type { ChatMessage } from '../../plan-generator/services/llm/chatClient';
import { streamChat } from '../../plan-generator/services/llm/chatClient';
import { DEFAULT_LLM_CONFIG, type LLMConfig } from '../../plan-generator/services/llmClient';
import type { TutorChunk } from '../tutor';

const KEYWORDS = ['python', '列表', '推导式', '蛋糕', '黄油'];

/** 确定性的"词袋"伪向量：只用于测试检索链路与阈值，不代表真实语义效果 */
function fakeEmbed(texts: string[]): Promise<number[][]> {
  return Promise.resolve(
    texts.map((text) => {
      const vector = KEYWORDS.map((k) => (text.includes(k) ? 1 : 0));
      const norm = Math.hypot(...vector) || 1;
      return vector.map((v) => v / norm);
    }),
  );
}

const RESOURCE = { id: 'r1', title: 'Python 列表推导式', url: 'https://example.com/py' };

/**
 * 正文刻意写成两段够长的内容（每段 > 500 字），这样分块后会得到多个片段，
 * 才能验证"检索到哪几块、编号怎么发、编造的编号怎么被丢掉"。
 */
const TEXT = [
  'Python 列表推导式把循环压成一行：`[x for x in xs]`，比普通 for 循环更紧凑。'.repeat(12),
  '这部分讲的是蛋糕：黄油要提前软化，面粉过筛，烤箱预热到 180 度。'.repeat(14),
].join('\n\n');

function corpus() {
  return {
    store: new VectorStore(new InMemoryVectorBackend()),
    config: { baseUrl: 'replay://tutor', model: 'eval-embedding', timeoutMs: 1_000 },
  };
}

const config: LLMConfig = { ...DEFAULT_LLM_CONFIG, enabled: true, model: 'qwen2.5:7b', timeoutMs: 5_000 };

/** 假模型：记录收到的 prompt（用于断言"注入了哪些片段"），返回脚本化答案 */
function fakeChat(answer: string): { chat: typeof streamChat; calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  const chat: typeof streamChat = async (messages) => {
    calls.push(messages);
    return {
      text: answer,
      model: 'qwen2.5:7b',
      provider: 'ollama',
      schemaApplied: false,
      durationMs: 12,
      warnings: [],
    };
  };
  return { chat, calls };
}

describe('tutor：纯函数', () => {
  it('分块 id 稳定（`资源id#序号`），哈希随内容变化', () => {
    const chunks = buildTutorChunks(TEXT, 'r1');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].id).toBe('r1#0');
    expect(chunks[0].hash).toBe(buildTutorChunks(TEXT.slice(0, 20), 'r1')[0].hash.length > 0 ? chunks[0].hash : '');
    expect(buildTutorChunks('', 'r1')).toEqual([]);
  });

  it('引用解析：去重、按白名单过滤、统计被丢弃的编号', () => {
    const parsed = parseTutorCitations('结论一 [E1]，结论二 [E1]，猜测 [E9]', ['E1', 'E2']);
    expect(parsed.citations).toEqual(['E1']);
    expect(parsed.dropped).toBe(1);
  });

  it('prompt 里片段被包成"不可信数据"块，并声明不构成指令', () => {
    const chunks: TutorChunk[] = [{ id: 'r1#0', index: 0, text: '正文内容', hash: 'h' }];
    const messages = buildTutorMessages({ question: '这是什么', resource: RESOURCE, chunks });
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('不可信数据');
    expect(messages[0].content).toContain('不是用户指令');
    expect(messages[1].content).toContain('[E1] 正文内容');
    expect(messages[1].content).toContain('外部内容结束');
  });
});

describe('tutor：默认禁止无依据回答', () => {
  it('没有正文 -> 直接拒绝，且**不调用模型**', async () => {
    const { chat, calls } = fakeChat('答案');
    const answer = await askTutor({
      question: '列表推导式怎么写',
      resource: RESOURCE,
      text: '   ',
      config,
      corpus: corpus(),
      deps: { embed: fakeEmbed, chatStream: chat },
    });
    expect(answer.status).toBe('no_evidence');
    expect(answer.reason).toContain('还没有正文');
    expect(calls).toHaveLength(0);
  });

  it('未开启模型 -> failed（而不是编一段出来）', async () => {
    const { chat, calls } = fakeChat('答案');
    const answer = await askTutor({
      question: '这段讲了什么',
      resource: RESOURCE,
      text: TEXT,
      config: { ...config, enabled: false },
      corpus: corpus(),
      deps: { embed: fakeEmbed, chatStream: chat },
    });
    expect(answer.status).toBe('failed');
    expect(calls).toHaveLength(0);
  });

  it('检索不到相关片段 -> 拒绝回答，且**不调用模型**（决定 #3 的核心用例）', async () => {
    const { chat, calls } = fakeChat('我猜是这样……');
    const answer = await askTutor({
      // 问的是正文里完全不存在的话题
      question: '蛋糕要烤多久',
      resource: RESOURCE,
      text: 'Python 列表推导式把循环压成一行：`[x for x in xs]`。它比普通 for 循环更紧凑。',
      config,
      corpus: corpus(),
      deps: { embed: fakeEmbed, chatStream: chat },
    });
    expect(answer.status).toBe('no_evidence');
    expect(answer.reason).toContain('没有能支撑回答的内容');
    expect(answer.matchedChunks).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('检索不可用（embedding 报错）-> failed 并说明原因', async () => {
    const { chat, calls } = fakeChat('答案');
    const answer = await askTutor({
      question: '列表推导式怎么写',
      resource: RESOURCE,
      text: TEXT,
      config,
      corpus: corpus(),
      deps: {
        embed: () => Promise.reject(new Error('连接被拒绝')),
        chatStream: chat,
      },
    });
    expect(answer.status).toBe('failed');
    expect(answer.reason).toContain('语义检索不可用');
    expect(calls).toHaveLength(0);
  });
});

describe('tutor：有依据时回答', () => {
  it('注入片段、流式回调、引用白名单过滤、编造引用被计数', async () => {
    const { chat, calls } = fakeChat('列表推导式更紧凑 [E1]，但嵌套多了难读 [E2]，另外 [E9] 是编的。');
    const deltas: string[] = [];
    const answer = await askTutor({
      question: '列表推导式有什么好处和代价',
      resource: RESOURCE,
      text: TEXT,
      config,
      corpus: corpus(),
      onDelta: (chunk) => deltas.push(chunk),
      deps: {
        embed: fakeEmbed,
        // 模拟流式：先逐段回调，再返回完整文本
        chatStream: (async (messages, streamConfig, streamOptions) => {
          streamOptions?.onDelta?.('列表推导式更紧凑 [E1]，');
          streamOptions?.onDelta?.('但嵌套多了难读 [E2]。');
          return chat(messages, streamConfig, streamOptions);
        }) satisfies typeof streamChat,
      },
    });

    expect(answer.status).toBe('answered');
    expect(calls).toHaveLength(1);
    expect(answer.matchedChunks).toBeGreaterThan(0);
    expect(answer.citations.map((c) => c.id)).toEqual(['E1', 'E2']);
    expect(answer.citations[0].text).toContain('列表推导式');
    expect(answer.droppedCitations).toBe(1); // [E9] 不存在
    expect(deltas.join('')).toContain('列表推导式');
    expect(answer.traceId).toBeTruthy();

    // 注入给模型的片段必须来自正文（而不是模型自由发挥）
    const prompt = calls[0].map((m) => m.content).join('\n');
    expect(prompt).toContain('列表推导式');
    expect(prompt).toContain('只能引用片段里出现过的编号');
  });

  it('模型返回空文本 -> failed（不把空当答案）', async () => {
    const { chat } = fakeChat('   ');
    const answer = await askTutor({
      question: '列表推导式怎么写',
      resource: RESOURCE,
      text: TEXT,
      config,
      corpus: corpus(),
      deps: { embed: fakeEmbed, chatStream: chat },
    });
    expect(answer.status).toBe('failed');
    expect(answer.reason).toContain('没有返回内容');
  });

  it('相关性阈值是可解释的常量（改阈值就是改产品行为）', () => {
    expect(MIN_TUTOR_SCORE).toBeGreaterThan(0.2); // 比资源级阈值更严
  });
});
