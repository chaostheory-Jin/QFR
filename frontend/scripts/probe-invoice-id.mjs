// Read-only, invoice-only diagnostic. No statement or expected answer is loaded.
import sharp from 'sharp'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { createHash } from 'node:crypto'

process.loadEnvFile('../.env')
const model = process.env.OPENAI_RECONCILIATION_MODEL || 'gpt-6-astra'
const directory = resolve('../output/reconciliation', `id-probe-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(directory, { recursive: true })
await Promise.all(process.argv.slice(2).map(async path => {
  const bytes = await readFile(path)
  const { data, info } = await sharp(bytes).rotate().png().toBuffer({ resolveWithObject: true })
  const box = [760, 208, 990, 253]
  const [x1,y1,x2,y2] = box
  const crop = await sharp(data).extract({ left: Math.floor(info.width*x1/1000), top: Math.floor(info.height*y1/1000), width: Math.floor(info.width*(x2-x1)/1000), height: Math.floor(info.height*(y2-y1)/1000) }).png().toBuffer()
  const views = [await sharp(crop).resize({width:2200}).png().toBuffer(), await sharp(crop).extractChannel('green').normalise().resize({width:2200}).png().toBuffer()]
  for (let i=0;i<views.length;i++) await writeFile(resolve(directory, `${basename(path)}-${i}.png`), views[i])
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: {Authorization:`Bearer ${process.env.OPENAI_API_KEY_QFR || process.env.OPENAI_API_KEY}`, 'Content-Type':'application/json'},
    body: JSON.stringify({model,store:false,reasoning:{effort:'high'},max_output_tokens:4000,input:[{role:'user',content:[
      {type:'input_text',text:'These are two views of the SAME printed invoice number field, original colour and green-channel contrast. Transcribe its printed identifier, character by character from left to right. Include alphabetic prefix. Ignore label, rule lines, and highlight marker. Do not infer from any external list or document. If a character is ambiguous put ? at that position. Return JSON with only invoiceNumber and uncertainCharacters (boolean).'},
      ...views.map(view=>({type:'input_image',image_url:`data:image/png;base64,${view.toString('base64')}`,detail:'original'}))
    ]}],text:{format:{type:'json_schema',name:'invoice_id',strict:true,schema:{type:'object',additionalProperties:false,properties:{invoiceNumber:{type:'string'},uncertainCharacters:{type:'boolean'}},required:['invoiceNumber','uncertainCharacters']}}}}),signal:AbortSignal.timeout(95000)
  })
  const payload=await response.json()
  await writeFile(resolve(directory,`${basename(path)}.json`),JSON.stringify({file:basename(path),sourceHash:createHash('sha256').update(bytes).digest('hex'),box,requestedModel:model,status:response.status,payload},null,2))
  console.log(JSON.stringify({file:basename(path),status:response.status,model:payload.model,text:payload.output?.flatMap(item=>item.content??[]).filter(item=>item.type==='output_text').map(item=>item.text),error:payload.error?.message,directory}))
}))
