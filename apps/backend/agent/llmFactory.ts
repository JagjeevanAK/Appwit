import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export type LLMProvider = 'openrouter' | 'anthropic' | 'openai';

const DEFAULT_MODELS: Record<LLMProvider, string> = {
    openrouter: 'anthropic/claude-sonnet-4-20250514',
    anthropic: 'claude-sonnet-4-20250514',
    openai: 'gpt-4o',
};

export class LLMFactory {
    private static instance: LLMFactory | null = null;

    private provider: LLMProvider;
    private model: string;

    private constructor() {
        this.provider = this.resolveProvider();
        this.model = this.resolveModel();
    }

    public static getInstance(): LLMFactory {
        if (!LLMFactory.instance) {
            LLMFactory.instance = new LLMFactory();
        }
        return LLMFactory.instance;
    }

    private resolveProvider(): LLMProvider {
        const provider = process.env.LLM_PROVIDER?.toLowerCase() as LLMProvider;
        return ['openrouter', 'anthropic', 'openai'].includes(provider) ? provider : 'openrouter';
    }

    private resolveModel(): string {
        return process.env.LLM_MODEL || DEFAULT_MODELS[this.provider];
    }

    public getProviderName(): LLMProvider {
        return this.provider;
    }

    public getModelName(): string {
        return this.model;
    }

    public create(): BaseChatModel {
        console.log(`\x1b[32m[LLM]\x1b[0m Provider: ${this.provider}, Model: ${this.model}`);

        switch (this.provider) {
            case 'anthropic':
                return new ChatAnthropic({
                    model: this.model,
                    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
                });

            case 'openai':
                return new ChatOpenAI({
                    model: this.model,
                    openAIApiKey: process.env.OPENAI_API_KEY,
                });

            case 'openrouter':
            default:
                return new ChatOpenAI({
                    model: this.model,
                    configuration: {
                        baseURL: "https://openrouter.ai/api/v1",
                        apiKey: process.env.OPENROUTER_API_KEY,
                    },
                });
        }
    }
}

export const createLLM = (): BaseChatModel => {
    return LLMFactory.getInstance().create();
};
