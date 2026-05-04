import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/use-theme'
import { isXiaolouEmbedded, postXiaolouThemeMessage } from '@/lib/xiaolou-embed'
import { MoonIcon, SunIcon } from 'lucide-react'

const ThemeButton: React.FC = () => {
  const { setTheme, theme } = useTheme()
  const isEmbedded = isXiaolouEmbedded()
  const nextTheme = theme === 'dark' ? 'light' : 'dark'

  return (
    <Button
      size={'sm'}
      variant={'ghost'}
      onClick={() => {
        if (isEmbedded) {
          postXiaolouThemeMessage({ type: 'xiaolou:theme:toggle' })
          return
        }

        setTheme(nextTheme)
      }}
    >
      {theme === 'dark' ? <SunIcon size={30} /> : <MoonIcon size={30} />}
    </Button>
  )
}

export default ThemeButton
