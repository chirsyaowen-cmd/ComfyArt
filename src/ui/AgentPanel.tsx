import { useLayoutEffect, useRef, useState } from 'react'
import { useValue, type Editor, type TLShapeId } from 'tldraw'

import { isRefShape, sendToAgent, type RefShape } from '../agent'
import { botEnabledAtom, branchFrom, chatIdAtom, chatsAtom, deleteChat, messagesAtom, openChat, providersAtom, stopTurn, type BotMessage } from '../bot'
import { chatFrameOf, locateChatFrame } from '../chatFrame'
import { errorText } from '../jobs'
import { libraryAtom } from '../library'
import { loadSkills } from '../skills'
import { botSettingsOpenAtom } from './AgentPicker'
import { dockAtom } from './chatDock'
import { AssistantBlocks, textOf, UserMessage } from './ChatMessage'
import { Composer } from './Composer'
import { Icons } from './icons'
import { Popover } from './Popover'
import { detailsAtom } from './TaskDetails'
import { CopyButton } from './CopyButton'
import { t } from '../i18n'

const NEAR_BOTTOM = 80

function History({ onError }: { onError: (msg: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const chats = useValue(chatsAtom)
  const current = useValue(chatIdAtom)
  const providers = useValue(providersAtom)
  const shown = chats.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()))
  const fail = (e: unknown) => onError(errorText(e))
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={({ open: o, toggle }) => (
        <button type="button" className="ca-bar__btn ca-split__chev" title={t('agentPanel.chatHistory')} data-open={o || undefined} onClick={toggle}>
          <span className="ca-icon">{Icons.chevron}</span>
        </button>
      )}
    >
      <div className="ca-menu ca-history">
        <div className="ca-gen__title">{t('agentPanel.chatHistory')}</div>
        <label className="ca-bg__hex">
          <span className="ca-icon">{Icons.search}</span>
          <input value={q} placeholder={t('agentPanel.enterASearchTerm')} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        {shown.length === 0 && <div className="ca-menu__empty">{t('agentPanel.noChatsYet')}</div>}
        {shown.map((c) => (
          <div key={c.id} className="ca-menu__item ca-history__item" data-on={c.id === current || undefined} onClick={() => { void openChat(c.id).catch(fail); setOpen(false) }}>
            <span className="ca-menu__grow">{c.title || t('agentPanel.newChat')}</span>
            <span className="ca-menu__key">{c.busy ? t('agentPanel.inProgress') : providers.find((p) => p.id === c.provider)?.label ?? c.provider}</span>
            <button type="button" className="ca-history__del" title={t('common.delete')} onClick={(e) => { e.stopPropagation(); void deleteChat(c.id).catch(fail) }}>{Icons.trash}</button>
          </div>
        ))}
      </div>
    </Popover>
  )
}

function refsOf(editor: Editor, m: BotMessage): RefShape[] {
  return m.blocks.flatMap((b) => {
    const shape = b.shape ? editor.getShape(b.shape as TLShapeId) : undefined
    return shape && isRefShape(shape) ? [shape] : []
  })
}

async function resend(editor: Editor, m: BotMessage) {
  const skillName = m.blocks.find((b) => b.type === 'skill')?.name
  const skill = skillName ? (await loadSkills()).find((s) => s.name === skillName) ?? null : null
  const kits = libraryAtom.get().filter((k) => m.blocks.some((b) => b.type === 'kit' && b.name === k.name))
  const docs = m.blocks.filter((b) => b.type === 'file' && b.url).map((b) => ({ src: b.url!, name: b.name ?? '' }))
  await sendToAgent(editor, textOf(m), refsOf(editor, m), skill, kits, docs)
}

export function AgentPanel({ editor, onError }: {
  editor: Editor
  onError: (msg: string) => void
}) {
  const messages = useValue(messagesAtom)
  const chat = useValue('current chat', () => chatsAtom.get().find((c) => c.id === chatIdAtom.get()) ?? null, [])
  const providers = useValue(providersAtom)
  const enabled = useValue(botEnabledAtom)
  const dock = useValue(dockAtom)
  const hasFrame = useValue('chat frame', () => !!(chat && chatFrameOf(editor, chat.id, true)), [editor, chat?.id])
  const list = useRef<HTMLDivElement>(null)
  const busy = !!chat?.busy
  const canBranch = providers.find((p) => p.id === chat?.provider)?.branch ?? false
  const fail = (e: unknown) => onError(errorText(e))

  const content = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const previousTop = useRef(0)
  const [away, setAway] = useState(false)
  const [height, setHeight] = useState(0)
  const toBottom = () => list.current?.scrollTo({ top: list.current.scrollHeight })
  const onScroll = () => {
    const el = list.current!
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM) follow.current = true
    else if (el.scrollTop < previousTop.current) follow.current = false
    previousTop.current = el.scrollTop
    setAway(!follow.current)
  }

  useLayoutEffect(() => {
    const body = content.current!
    const viewport = list.current!
    const observer = new ResizeObserver((entries) => {
      if (entries.some((entry) => entry.target === body)) {
        setHeight(body.offsetHeight)
      }
      if (follow.current) toBottom()
    })
    observer.observe(body)
    observer.observe(body.parentElement!)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const lastUser = messages[messages.map((m) => m.role).lastIndexOf('user')]
  useLayoutEffect(() => {
    follow.current = true
    setAway(false)
    toBottom()
  }, [chat?.id, lastUser?.id])

  return (
    <aside className="ca-agent" data-dock={dock} aria-label={t('canvasChat.chat')}>
      <div className="ca-agent__head">
        <span className="ca-agent__title">{chat?.title || t('agentPanel.newChat')}</span>
        <div className="ca-split">
          <button type="button" className="ca-bar__btn ca-bar__btn--icon" title={t('agentPanel.createChat')} onClick={() => void openChat(null)}>
            <span className="ca-icon">{Icons.page}</span>
          </button>
          <History onError={onError} />
        </div>
        {chat && hasFrame && (
          <button type="button" className="ca-bar__btn ca-bar__btn--icon" title={t('chatFrame.locateFrame')} onClick={() => locateChatFrame(editor, chat.id)}>
            <span className="ca-icon">{Icons.frame}</span>
          </button>
        )}
        {enabled === false && (
          <button type="button" className="ca-bar__btn" title={t('agentPanel.agentIsNotEnabledYet')} onClick={() => botSettingsOpenAtom.set(true)}>
            {t('agentPanel.openAgentSettings')}
          </button>
        )}
      </div>
      <div ref={list} className="ca-chat" onScroll={onScroll}>
        <div className="ca-chat__reveal" data-streaming={busy || undefined} style={{ height: busy ? height : undefined }}>
          <div ref={content} className="ca-chat__content">
            {messages.map((m, i) => (m.role === 'system'
              ? <div key={m.id} className="ca-chat__notice"><strong>{t('composer.scheduledTask')}</strong> {textOf(m)}</div>
              : m.role === 'user'
              ? <UserMessage key={m.id} editor={editor} m={m} onBranch={canBranch && !busy ? () => void branchFrom(m.id).catch(fail) : undefined} />
              : (
                <div key={m.id} className="ca-chat__bot">
                  <AssistantBlocks editor={editor} m={m} />
                  {m.status === 'streaming' && (
                    <div className="ca-chat__thinking">
                      <span>{m.blocks.length ? t('agentPanel.working') : t('agentPanel.thinking')}</span>
                      <button type="button" className="ca-panel__chip" onClick={() => void stopTurn().catch(fail)}>{t('agentPanel.stop')}</button>
                    </div>
                  )}
                  {m.status === 'aborted' && <div className="ca-chat__hint">{t('agentPanel.stopped')}</div>}
                  {m.status !== 'streaming' && (
                    <div className="ca-chat__acts ca-chat__acts--bot">
                      {!busy && i === messages.length - 1 && lastUser && lastUser.id === messages[i - 1]?.id && (
                        <button type="button" className="ca-history__del" title={t('common.regenerate')} onClick={() => void resend(editor, lastUser).catch(fail)}>{Icons.replace}</button>
                      )}
                      <CopyButton text={textOf(m)} />
                      <button type="button" className="ca-history__del" title={t('agentPanel.taskDetails')} onClick={() => detailsAtom.set(m.id)}>{Icons.files}</button>
                    </div>
                  )}
                </div>
              )))}
          </div>
        </div>
      </div>
      {away && <div className="ca-chat__jump-slot"><button type="button" className="ca-chat__jump" title={t('agentPanel.jumpToLatest')} onClick={toBottom}><span className="ca-icon">{Icons.chevron}</span></button></div>}
      <Composer editor={editor} busy={busy} onError={onError} />
    </aside>
  )
}
