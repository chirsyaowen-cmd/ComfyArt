import { fileInsertionPoint } from '../zine'
import { useRef, useState } from 'react'
import { useEditor, useValue } from 'tldraw'

import { addComposeShape, createBoard, importLayout } from '../compose'
import { errorText } from '../jobs'
import { GENBLOCK, QR } from '../shapes/ComposeShapes'
import { COMMENT, commentKindAtom, type CommentKind } from '../shapes/CommentShape'
import { DOODLE } from '../shapes/DoodleShape'
import { PEN } from '../shapes/PenTool'
import { TEXT } from '../shapes/TextShape'
import { VECTOR, vectorKindAtom } from '../shapes/VectorShape'
import { DoodleBar } from './DoodleBar'
import { NativeStyleBar } from './NativeStyleBar'
import { Icons } from './icons'
import { Popover } from './Popover'
import { t } from '../i18n'

const INSERTS: [string, string, keyof typeof Icons, string, string?][] = [
  ['text', t('common.text'), 'textTool', 'T'], ['rect', t('common.rectangle'), 'rect', 'R'], ['ellipse', t('dock.circle'), 'ellipse', 'O'], ['polygon', t('dock.polygon'), 'polygon', ''], ['star', t('dock.star'), 'star', ''], ['pen', t('dock.pen'), 'pen', 'P'],
  ['line', t('dock.line'), 'minus', 'L'], ['arrow', t('dock.arrow'), 'link', 'Shift L'], ['note', t('dock.stickyNote'), 'page', 'N'], ['frame', t('common.artboard'), 'frame', 'F'],
]
const COMPOSE_INSERTS: [string, string, keyof typeof Icons][] = [
  ['board', t('compose.board'), 'frame'], [QR, t('compose.qrCode'), 'qr'],
]


const KINDS: [CommentKind, string, keyof typeof Icons][] = [['point', t('dock.clickSelect'), 'comment'], ['lasso', t('dock.lassoSelect'), 'lasso'], ['box', t('dock.boxSelect'), 'box']]

function CommentBar() {
  const kind = useValue(commentKindAtom)
  return (
    <div className="ca-bar">
      {KINDS.map(([k, label, icon]) => (
        <button key={k} type="button" className="ca-bar__btn ca-bar__btn--icon" title={label} data-on={kind === k || undefined} onClick={() => commentKindAtom.set(k)}>
          <span className="ca-icon">{Icons[icon]}</span>
        </button>
      ))}
    </div>
  )
}

export function Dock({ onError }: { onError: (msg: string) => void }) {
  const editor = useEditor()
  const tool = useValue('tool', () => editor.getCurrentToolId(), [editor])
  const [insert, setInsert] = useState(false)
  const upload = useRef<HTMLInputElement>(null)
  const layout = useRef<HTMLInputElement>(null)

  const pickTool = (id: string) => {
    setInsert(false)
    if (id === 'text') editor.setCurrentTool(TEXT)
    else if (id === 'rect' || id === 'ellipse' || id === 'polygon' || id === 'star') { vectorKindAtom.set(id); editor.setCurrentTool(VECTOR) }
    else if (id === 'pen') editor.setCurrentTool(PEN)
    else editor.setCurrentTool(id)
  }
  const inserting = tool === TEXT || tool === VECTOR || tool === PEN || ['line', 'arrow', 'note', 'frame'].includes(tool)

  return (
    <div className="ca-dock" onPointerDown={(e) => e.stopPropagation()}>
      {tool === COMMENT ? <CommentBar /> : <><DoodleBar /><NativeStyleBar /></>}
      <div className="ca-bar">
        <button type="button" className="ca-bar__btn" data-on={tool === 'select' || undefined} title={t('dock.selectV')} onClick={() => editor.setCurrentTool('select')}>
          <span className="ca-icon">{Icons.select}</span><span>{t('dock.select')}</span>
        </button>
        <button type="button" className="ca-bar__btn" data-on={tool === COMMENT || undefined} title={t('dock.commentC')} onClick={() => editor.setCurrentTool(COMMENT)}>
          <span className="ca-icon">{Icons.comment}</span><span>{t('common.comment')}</span>
        </button>
        <button type="button" className="ca-bar__btn" data-on={tool === DOODLE || undefined} title={t('dock.drawD')} onClick={() => editor.setCurrentTool(DOODLE)}>
          <span className="ca-icon">{Icons.doodle}</span><span>{t('common.draw')}</span>
        </button>
        <Popover
          open={insert}
          onOpenChange={setInsert}
          side="top"
          trigger={({ open, toggle }) => (
            <button type="button" className="ca-bar__btn" data-on={inserting || undefined} data-open={open || undefined} title={t('dock.insert')} onClick={toggle}>
              <span className="ca-icon">{Icons.plus}</span><span>{t('dock.insert')}</span>
            </button>
          )}
        >
          <div className="ca-menu">
            <button type="button" className="ca-menu__item" onClick={() => { setInsert(false); upload.current?.click() }}>
              <span className="ca-icon">{Icons.upload}</span><span className="ca-menu__grow">{t('common.uploadFile')}</span><span className="ca-menu__key">{t('dock.imageVideoPdf3dLottie')}</span>
            </button>
            <div className="ca-menu__sep" />
            {INSERTS.map(([id, label, icon, key]) => (
              <button key={id} type="button" className="ca-menu__item" onClick={() => pickTool(id)}>
                <span className="ca-icon">{Icons[icon]}</span><span className="ca-menu__grow">{label}</span>{key && <span className="ca-menu__key">{key}</span>}
              </button>
            ))}
            <div className="ca-menu__sep" />
            {COMPOSE_INSERTS.map(([id, label, icon]) => (
              <button key={id} type="button" className="ca-menu__item" onClick={() => { setInsert(false); if (id === 'board') createBoard(editor); else addComposeShape(editor, id as typeof GENBLOCK) }}>
                <span className="ca-icon">{Icons[icon]}</span><span className="ca-menu__grow">{label}</span>
              </button>
            ))}
            <button type="button" className="ca-menu__item" onClick={() => { setInsert(false); layout.current?.click() }}>
              <span className="ca-icon">{Icons.upload}</span><span className="ca-menu__grow">{t('compose.importLayout')}</span>
            </button>
          </div>
        </Popover>
        <input
          ref={upload}
          type="file"
          multiple
          hidden
          accept="image/*,.heic,.heif,.heics,.heifs,video/*,.pdf,.json,.lottie,.html,.htm,.glb,.gltf,.obj,.fbx,.stl,.ply,.mp3,.wav,.flac,.ogg,.m4a,.opus"
          onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) void editor.putExternalContent({ type: 'files', files, point: fileInsertionPoint(editor) }); e.target.value = '' }}
        />
        <input ref={layout} type="file" hidden accept=".json" onChange={(e) => { const f = e.target.files?.[0]; if (f) importLayout(editor, f).catch((err) => onError(errorText(err))); e.target.value = '' }} />

      </div>
    </div>
  )
}
