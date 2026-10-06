// Pure helpers of the touch layout: which sessions live inside a folder (Linux and Windows paths), the most urgent
// state among them, the short name of a model; free names for uploads, what a turn changed in a folder, highlighted
// code split into lines.
import { describe, expect, it } from 'vitest'
import type { FileEntry, TabMeta } from '@athome/protocol'
import { renderToStaticMarkup } from 'react-dom/server'
import { answeredQuestions, durationLabel, filesChanged, folderSummary, freeName, htmlLines, inside, modelShortName, resetLabel, sessionState, spanNodes, tokenLabel } from './model.ts'

const tab = (cwd: string, status: TabMeta['status']): TabMeta => ({ tabId: cwd + status, title: 't', cwd, status, mode: 'default', queue: [], pendingRequests: 0 })

describe('touch model', () => {
  it('tokens, durations and reset times read short, as the panels show them', () => {
    expect([850, 48500, 200000, 1250000].map((tokens) => tokenLabel(tokens, 'en-US'))).toEqual(['850', '48.5k', '200k', '1.3M'])
    expect(tokenLabel(48500, 'it-IT')).toBe('48,5k')
    expect([45000, 95000, 120000, 7500000].map(durationLabel)).toEqual(['45 s', '1 min 35 s', '2 min', '2 h 5 min'])
    // "Claude is working · …" past a minute and an hour.
    expect([59400, 567000, 3600000].map(durationLabel)).toEqual(['59 s', '9 min 27 s', '1 h'])
    const now = new Date(2026, 9, 3, 18, 0)
    expect(resetLabel(new Date(2026, 9, 3, 22, 0).toISOString(), now, 'en-GB')).toBe('22:00')
    expect(resetLabel(new Date(2026, 9, 8, 11, 0).toISOString(), now, 'en-GB')).toBe('Thu 8 Oct, 11:00')
  })

  it('a path is inside a folder when it is the folder or below it, on Linux and on Windows', () => {
    expect(inside('/srv/progetti/app/src', '/srv/progetti/app')).toBe(true)
    expect(inside('/srv/progetti/app', '/srv/progetti/app/')).toBe(true)
    expect(inside('/srv/progetti/application', '/srv/progetti/app')).toBe(false)
    expect(inside('C:\\Users\\me\\Repo\\app', 'c:\\users\\me\\repo')).toBe(true)
    expect(inside('C:\\Users\\me\\Repository', 'C:\\Users\\me\\Repo')).toBe(false)
  })

  it('a folder shows how many sessions are open inside it and the most urgent state', () => {
    const tabs = [tab('/srv/p/a', 'idle'), tab('/srv/p/a/sub', 'running'), tab('/srv/p/a', 'requires_action'), tab('/srv/p/b', 'error')]
    expect(folderSummary(tabs, '/srv/p/a')).toEqual({ open: 3, state: 'waiting' })
    expect(folderSummary(tabs, '/srv/p/b')).toEqual({ open: 1, state: 'error' })
    expect(folderSummary(tabs, '/srv/p/c')).toEqual({ open: 0, state: 'idle' })
    expect(sessionState(tab('/x', 'starting'))).toBe('working')
    expect(sessionState(tab('/x', 'dormant'))).toBe('idle')
  })

  it('a model id becomes its short name with the version', () => {
    expect(modelShortName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelShortName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelShortName('claude-sonnet-5')).toBe('Sonnet 5')
    expect(modelShortName('fake-model')).toBe('fake-model')
  })

  it('an upload gets a free name, also among the files of the same batch', () => {
    const taken = new Set(['image.jpg', 'notes'])
    expect(freeName('image.jpg', taken)).toBe('image (2).jpg')
    expect(freeName('image.jpg', taken)).toBe('image (3).jpg')
    expect(freeName('notes', taken)).toBe('notes (2)')
    expect(freeName('.env', taken)).toBe('.env')
    expect(freeName('.env', taken)).toBe('.env (2)')
  })

  it('the end of a turn tells which files were created and which modified', () => {
    const entry = (name: string, modified: number, kind: FileEntry['kind'] = 'file'): FileEntry => ({ name, kind, size: 10, modified })
    const before = [entry('a.ts', 1), entry('b.ts', 1), entry('src', 1, 'folder')]
    const after = [entry('a.ts', 1), entry('b.ts', 2), entry('c.ts', 2), entry('src', 2, 'folder')]
    expect(filesChanged(before, after)).toEqual({ created: ['c.ts'], modified: ['b.ts'] })
  })

  it('highlighted code splits into lines with every span closed and reopened', () => {
    const html = '<span class="hljs-comment">/* one\ntwo */</span> x\n<span class="a">y <span class="b">z</span></span>'
    expect(htmlLines(html)).toEqual(['<span class="hljs-comment">/* one</span>', '<span class="hljs-comment">two */</span> x', '<span class="a">y <span class="b">z</span></span>'])
  })

  it('highlighted spans become React nodes; the escaped text is never parsed as HTML', () => {
    const markup = renderToStaticMarkup(spanNodes('<span class="hljs-string">&quot;&lt;img src=x onerror=alert(1)&gt;&quot;</span> &amp; <b>'))
    expect(markup).toBe('<span class="hljs-string">&quot;&lt;img src=x onerror=alert(1)&gt;&quot;</span> &amp; &lt;b&gt;')
  })

  it('reads the answers of a question form from the CLI result, quotes and commas inside them included', () => {
    const input = {
      questions: [
        { question: 'Which "color"?', header: 'Color', multiSelect: false, options: [] },
        { question: 'Which sizes?', header: 'Size', multiSelect: true, options: [] },
        { question: 'Skipped?', header: 'Other', multiSelect: false, options: [] }
      ]
    }
    const result = 'Your questions have been answered: "Which "color"?"="Blue, "deep"", "Which sizes?"="Small, Large". You can now continue with these answers in mind.'
    expect(answeredQuestions(input, result)).toEqual([
      { header: 'Color', question: 'Which "color"?', answer: 'Blue, "deep"' },
      { header: 'Size', question: 'Which sizes?', answer: 'Small, Large' },
      { header: 'Other', question: 'Skipped?', answer: undefined }
    ])
    const careful = 'The user answered: "Which sizes?"="Large". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.'
    expect(answeredQuestions(input, careful).map((entry) => entry.answer)).toEqual([undefined, 'Large', undefined])
    expect(answeredQuestions(input, 'The user did not answer the questions.').every((entry) => entry.answer === undefined)).toBe(true)
    expect(answeredQuestions({}, 'anything')).toEqual([])
  })
})
