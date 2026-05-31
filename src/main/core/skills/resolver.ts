import type { SkillSummary } from '../../../shared/contracts'

export interface ResolvedSkillCandidate {
  skill: SkillSummary
  score: number
  explicitMention: boolean
  reasons: string[]
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'assist', 'assistant', 'build', 'can', 'code', 'create', 'do', 'for', 'help',
  'i', 'in', 'is', 'it', 'me', 'my', 'need', 'of', 'on', 'please', 'review', 'run', 'show', 'skill',
  'task', 'that', 'the', 'this', 'to', 'use', 'with', '帮我', '技能', '请', '一下', '一个', '需要', '帮', '做'
])

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildCjkBigrams(token: string) {
  const normalized = token.trim()
  if (normalized.length <= 2) {
    return normalized ? [normalized] : []
  }

  const bigrams: string[] = []
  for (let index = 0; index < normalized.length - 1; index += 1) {
    bigrams.push(normalized.slice(index, index + 2))
  }
  return bigrams
}

function tokenizeSearchText(value: string) {
  const normalized = normalizeSearchText(value)
  if (!normalized) {
    return []
  }

  const rawTokens = normalized.split(' ')
  const tokens = new Set<string>()

  for (const rawToken of rawTokens) {
    const token = rawToken.trim()
    if (!token || STOP_WORDS.has(token)) {
      continue
    }

    tokens.add(token)
    if (/[\u3400-\u9fff]/u.test(token)) {
      for (const bigram of buildCjkBigrams(token)) {
        if (!STOP_WORDS.has(bigram)) {
          tokens.add(bigram)
        }
      }
    }
  }

  return Array.from(tokens)
}

function countOverlappingTokens(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0
  }

  const rightSet = new Set(right)
  return left.filter((token) => rightSet.has(token)).length
}

function buildSkillSearchDocument(skill: SkillSummary) {
  return {
    id: normalizeSearchText(skill.id),
    name: normalizeSearchText(skill.name),
    descriptionTokens: tokenizeSearchText(skill.description),
    whenToUseTokens: tokenizeSearchText(skill.whenToUse),
    contentTokens: tokenizeSearchText(skill.content.slice(0, 800))
  }
}

function isExplicitSkillMention(input: string, skill: SkillSummary) {
  const normalizedInput = normalizeSearchText(input)
  if (!normalizedInput) {
    return false
  }

  const candidates = [
    normalizeSearchText(skill.id),
    normalizeSearchText(skill.name)
  ].filter((value) => value.length >= 2)

  return candidates.some((candidate) => (
    normalizedInput === candidate
    || normalizedInput.includes(candidate)
  ))
}

export function resolveRelevantSkills(
  input: string,
  skills: SkillSummary[],
  options?: {
    maxResults?: number
    autoLoadThreshold?: number
  }
) {
  const normalizedInput = normalizeSearchText(input)
  if (!normalizedInput) {
    return []
  }

  const inputTokens = tokenizeSearchText(normalizedInput)
  const maxResults = Math.max(1, options?.maxResults ?? 3)
  const autoLoadThreshold = Math.max(1, options?.autoLoadThreshold ?? 18)
  const candidates: ResolvedSkillCandidate[] = []

  for (const skill of skills) {
    const explicitMention = isExplicitSkillMention(normalizedInput, skill)
    if (explicitMention && skill.userInvocable === false) {
      continue
    }
    if (!explicitMention && skill.modelInvocable === false) {
      continue
    }

    const document = buildSkillSearchDocument(skill)
    let score = 0
    const reasons: string[] = []

    if (explicitMention) {
      score += 40
      reasons.push('explicit_name_match')
    }

    if (document.id && normalizedInput.includes(document.id)) {
      score += 18
      reasons.push('id_match')
    }

    if (document.name && normalizedInput.includes(document.name)) {
      score += 20
      reasons.push('name_match')
    }

    const descriptionOverlap = countOverlappingTokens(inputTokens, document.descriptionTokens)
    const whenToUseOverlap = countOverlappingTokens(inputTokens, document.whenToUseTokens)
    const contentOverlap = countOverlappingTokens(inputTokens, document.contentTokens)

    if (descriptionOverlap > 0) {
      score += descriptionOverlap * 5
      reasons.push(`description_overlap:${descriptionOverlap}`)
    }

    if (whenToUseOverlap > 0) {
      score += whenToUseOverlap * 10
      reasons.push(`when_to_use_overlap:${whenToUseOverlap}`)
    }

    if (contentOverlap > 0) {
      score += Math.min(8, contentOverlap * 2)
      reasons.push(`content_overlap:${contentOverlap}`)
    }

    if (score >= autoLoadThreshold) {
      candidates.push({
        skill,
        score,
        explicitMention,
        reasons
      })
    }
  }

  return candidates
    .sort((left, right) => {
      if (left.explicitMention !== right.explicitMention) {
        return left.explicitMention ? -1 : 1
      }
      if (left.score !== right.score) {
        return right.score - left.score
      }
      return left.skill.name.localeCompare(right.skill.name)
    })
    .slice(0, maxResults)
}

export interface SkillResolverEvalCase {
  input: string
  expectedSkillIds: string[]
}

export function evaluateSkillResolver(
  cases: SkillResolverEvalCase[],
  skills: SkillSummary[],
  options?: {
    maxResults?: number
    autoLoadThreshold?: number
  }
) {
  const results = cases.map((testCase) => {
    const resolved = resolveRelevantSkills(testCase.input, skills, options)
    const resolvedSkillIds = resolved.map((candidate) => candidate.skill.id)
    const expected = new Set(testCase.expectedSkillIds)
    const matched = resolvedSkillIds.filter((skillId) => expected.has(skillId))
    const missed = testCase.expectedSkillIds.filter((skillId) => !resolvedSkillIds.includes(skillId))
    const unexpected = resolvedSkillIds.filter((skillId) => !expected.has(skillId))
    return {
      input: testCase.input,
      expectedSkillIds: [...testCase.expectedSkillIds],
      resolvedSkillIds,
      matched,
      missed,
      unexpected,
      pass: missed.length === 0 && unexpected.length === 0
    }
  })
  const passed = results.filter((result) => result.pass).length
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    accuracy: results.length === 0 ? 1 : passed / results.length,
    results
  }
}
