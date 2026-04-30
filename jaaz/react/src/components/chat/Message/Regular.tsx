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
          <div className="flex w-fit max-w-[86%] flex-col rounded-2xl rounded-tr-md bg-slate-900 px-4 py-3 text-left text-[15px] leading-6 text-white shadow-[0_8px_22px_rgba(15,23,42,0.16)] dark:bg-slate-100 dark:text-slate-950">
            <Markdown>{markdownText}</Markdown>
          </div>
        </div>
      ) : (
        <div className="mb-5 flex flex-col items-start text-left text-[15px] leading-7 text-slate-800 dark:text-slate-100 [&_a]:font-medium [&_a]:text-slate-950 dark:[&_a]:text-white [&_li]:my-1 [&_ol]:pl-5 [&_p]:mb-3 [&_ul]:pl-5">
          <Markdown>{markdownText}</Markdown>
        </div>
      )}
    </>
  )
}

export default MessageRegular
