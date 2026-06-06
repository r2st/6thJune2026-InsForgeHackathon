// Hush guardrails - comprehensive AI safety for diagnosis and code generation

import { GuardrailEngine } from '@llm-guardrails/core';

/**
 * Guardrail configuration for Hush
 * 
 * We use a standard level with guards that are critical for our use case:
 * - injection: prevent prompt injection attacks
 * - pii: protect against PII in both inputs and outputs
 * - secrets: prevent API key/token leaks in generated code
 * - toxicity: ensure appropriate professional language
 */
const guardrailConfig = {
  guards: ['injection', 'pii', 'secrets', 'toxicity'],
  level: 'standard',
};

/**
 * Singleton guardrail engine instance
 */
let guardrailEngine: GuardrailEngine | null = null;

/**
 * Initialize the guardrail engine (lazy initialization)
 */
export function getGuardrailEngine(): GuardrailEngine {
  if (!guardrailEngine) {
    guardrailEngine = new GuardrailEngine(guardrailConfig);
  }
  return guardrailEngine;
}

/**
 * Check input before it reaches the LLM
 * 
 * Used for:
 * - User session data before diagnosis
 * - User-provided context before code generation
 * - Any unstructured input from external sources
 */
export async function checkInput(input: string, context: string = 'default'): Promise<{
  safe: boolean;
  reason?: string;
  confidence: number;
}> {
  const engine = getGuardrailEngine();
  const result = await engine.checkInput(input);

  return {
    safe: !result.blocked,
    reason: result.reason || undefined,
    confidence: result.confidence || 0
  };
}

/**
 * Check output after LLM generation
 * 
 * Used for:
 * - TOML diffs before applying
 * - Diagnosis results before being stored
 * - Any AI-generated code before execution
 */
export async function checkOutput(output: string, context: string = 'default'): Promise<{
  safe: boolean;
  reason?: string;
  confidence: number;
  violations: string[];
}> {
  const engine = getGuardrailEngine();
  const result = await engine.checkOutput(output);

  // Extract specific violations for detailed logging
  const violations: string[] = [];
  if (result.blocked) {
    violations.push(result.reason || 'blocked');
  }
  
  // Check for specific patterns that are concerning for Hush
  if (output.includes('sk_') || output.includes('sk.')) {
    violations.push('potential Stripe key detected');
  }
  if (output.includes('AIza') && output.length > 35) {
    violations.push('potential Google API key detected');
  }
  if (output.includes('Bearer ') && output.length > 20) {
    violations.push('potential bearer token detected');
  }

  return {
    safe: !result.blocked && violations.length === 0,
    reason: result.reason || undefined,
    confidence: result.confidence || 0,
    violations
  };
}

/**
 * Check if a TOML diff is safe to apply
 * 
 * Specific guardrail for the critical code generation path
 */
export async function checkTomlDiffSafety(tomlDiff: string): Promise<{
  safe: boolean;
  reason?: string;
  violations: string[];
  confidence: number;
}> {
  const engine = getGuardrailEngine();
  
  // Check for dangerous patterns in TOML diffs
  const violations: string[] = [];
  
  // Check for potential privilege escalation
  if (tomlDiff.includes('ALTER ROLE') || tomlDiff.includes('GRANT ALL')) {
    violations.push('potential privilege escalation detected');
  }
  
  // Check for dropping RLS entirely
  if (tomlDiff.includes('USING (') && tomlDiff.includes('FOR ALL')) {
    violations.push('RLS bypass attempt detected');
  }
  
  // Check for suspicious external calls
  if (tomlDiff.includes('http://') || tomlDiff.includes('https://')) {
    violations.push('external URL in config - possible data exfiltration');
  }
  
  // Use the general guardrail check
  const outputCheck = await checkOutput(tomlDiff, 'toml-diff');
  
  return {
    safe: outputCheck.safe && violations.length === 0,
    reason: violations.length > 0 ? violations.join('; ') : outputCheck.reason,
    violations: [...violations, ...outputCheck.violations],
    confidence: outputCheck.confidence
  };
}

/**
 * Guardrail check for diagnosis prompts
 * 
 * Ensures the system prompt and user data separation is maintained
 */
export async function checkDiagnosisPrompt(prompt: string): Promise<{
  safe: boolean;
  reason?: string;
  confidence: number;
}> {
  // Check for common injection attempts in diagnosis context
  const injectionPatterns = [
    'ignore previous instructions',
    'act as',
    'you are now',
    'system:',
    'assistant:',
    'RLS = tenant_id IS NOT NULL', // Specific to our use case
    'DROP POLICY',
    'GRANT ALL'
  ];
  
  const lowerPrompt = prompt.toLowerCase();
  const foundPatterns = injectionPatterns.filter(pattern => 
    lowerPrompt.includes(pattern.toLowerCase())
  );
  
  if (foundPatterns.length > 0) {
    return {
      safe: false,
      reason: `Injection markers found: ${foundPatterns.join(', ')}`,
      confidence: 0.9
    };
  }
  
  // Use the general guardrail check
  return await checkInput(prompt, 'diagnosis-prompt');
}

/**
 * Get guardrail statistics for monitoring
 */
export function getGuardrailStats() {
  return {
    config: guardrailConfig,
    engineInitialized: guardrailEngine !== null,
    version: '1.0.0'
  };
}