import CommonDialogContent from '@/components/common/DialogContent'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type CanvasDeleteDialogProps = {
  show: boolean
  className?: string
  children?: React.ReactNode
  setShow: (show: boolean) => void
  handleDeleteCanvas: () => void
}

const CanvasDeleteDialog: React.FC<CanvasDeleteDialogProps> = ({
  show,
  className,
  children,
  setShow,
  handleDeleteCanvas,
}) => {
  const { t } = useTranslation()

  return (
    <Dialog open={show} onOpenChange={setShow}>
      <DialogTrigger asChild>
        {children ? (
          children
        ) : (
          <Button variant="destructive" size="icon" className={className}>
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </DialogTrigger>

      <CommonDialogContent open={show}>
        <DialogHeader>
          <DialogTitle>{t('canvas:deleteDialog.title')}</DialogTitle>
        </DialogHeader>

        <DialogDescription>
          {t('canvas:deleteDialog.description')}
        </DialogDescription>

        <DialogFooter>
          <Button variant="outline" onClick={() => setShow(false)}>
            {t('canvas:deleteDialog.cancel')}
          </Button>
          <Button variant="destructive" onClick={() => handleDeleteCanvas()}>
            {t('canvas:deleteDialog.delete')}
          </Button>
        </DialogFooter>
      </CommonDialogContent>
    </Dialog>
  )
}

export default CanvasDeleteDialog
