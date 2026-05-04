import { ToolResultMessage } from '@/types/types'
import { AnimatePresence, motion } from 'motion/react'
import { Markdown } from '../Markdown'

type ToolCallContentProps = {
  expandingToolCalls: string[]
  message: ToolResultMessage
}

export const ToolCallContent: React.FC<ToolCallContentProps> = ({
  expandingToolCalls,
  message,
}) => {
  const isExpanded = expandingToolCalls.includes(message.tool_call_id)

  if (message.content.includes('<hide_in_user_ui>')) {
    return null
  }

  return (
    <AnimatePresence>
      {isExpanded && (
        <motion.div
          initial={{ opacity: 0, y: -5, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -5, height: 0 }}
          layout
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="p-3 bg-muted rounded-lg"
        >
          <Markdown>{message.content}</Markdown>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const ToolCallContentV2: React.FC<{ content: string }> = ({ content }) => {
  if (content.includes('<hide_in_user_ui>')) {
    return null
  }

  return (
    <div className="p-2 bg-muted rounded-lg">
      <Markdown>{content}</Markdown>
    </div>
  )
}

export default ToolCallContentV2
