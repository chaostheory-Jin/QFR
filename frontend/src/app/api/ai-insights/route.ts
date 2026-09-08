import { NextResponse } from 'next/server'
import { openAIApiKey } from '@/lib/openai-key'

type AIInsightsRequest = {
  question?: string
  localDraft?: string
  datasetSummary?: string
  sampleRows?: unknown[]
}

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

export async function POST(request: Request) {
  const body = (await request.json()) as AIInsightsRequest
  const question = body.question?.trim()
  const localDraft = body.localDraft?.trim()

  if (!question || !localDraft) {
    return NextResponse.json({ error: 'Question and localDraft are required.' }, { status: 400 })
  }

  const apiKey = openAIApiKey(request)
  if (!apiKey) {
    return NextResponse.json({ error: 'No API key configured. Add one on login or set OPENAI_API_KEY_QFR.' }, { status: 503 })
  }

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a concise finance reporting assistant. Use the provided P&L and balance sheet context. Call out assumptions and sign-convention caveats.',
        },
        {
          role: 'user',
          content:
            `Question:\n${question}` +
            `\n\nLocal computed draft:\n${localDraft}` +
            `\n\nDataset summary:\n${body.datasetSummary || 'No summary provided.'}` +
            `\n\nSample rows:\n${JSON.stringify(body.sampleRows ?? [])}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 900,
    }),
  })

  if (!response.ok) {
    return NextResponse.json({ error: `OpenAI error: ${response.status}` }, { status: response.status })
  }

  const data = await response.json()
  const answer = data?.choices?.[0]?.message?.content

  if (!answer) {
    return NextResponse.json({ error: 'OpenAI returned an empty answer.' }, { status: 502 })
  }

  return NextResponse.json({ answer })
}
