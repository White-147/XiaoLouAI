import { Message, MessageContent } from '@/types/types'
import { Markdown } from '../Markdown'
import MessageImage from './Image'

type MessageRegularProps = {
  message: Message
  content: MessageContent | string
}

const MessageRegular: React.FC<MessageRegularProps> = ({
  message,
  content,
}) => {
  const isStrContent = typeof content === 'string'
  const isText = isStrContent || (!isStrContent && content.type == 'text')

  const markdownText = isStrContent
    ? content
    : content.type === 'text'
      ? content.text
      : ''
  if (!isText) return <MessageImage content={content} />

  return (
    <>
      {message.role === 'user' ? (
        <div className="flex justify-end mb-4">
          <div className="bg-primary text-primary-foreground rounded-xl rounded-br-md px-4 py-3 text-left max-w-[300px] w-fit flex flex-col">
            <Markdown>{markdownText}</Markdown>
          </div>
        </div>
      ) : (
        <div className="text-gray-800 dark:text-gray-200 text-left items-start mb-4 flex flex-col">
          <Markdown>{markdownText}</Markdown>
        </div>
      )}
    </>
  )
}

export default MessageRegular
