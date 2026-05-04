import { Button } from '@/components/ui/button'
import {
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  UploadIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRef } from 'react'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Checkbox } from '../ui/checkbox'
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  Dialog,
  DialogDescription,
} from '../ui/dialog'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card'
import { Badge } from '../ui/badge'
import { Label } from '../ui/label'
import { Separator } from '../ui/separator'

export type ComfyWorkflowInput = {
  name: string
  type: 'string' | 'number' | 'boolean'
  description: string
  node_id: string
  node_input_name: string
  default_value: string | number | boolean
  required: boolean
}

type ComfyWorkflowFromAPI = {
  id: number
  name: string
  description: string
  api_json: string
  inputs: string
  outputs: string
}

export type ComfyWorkflow = {
  id: number
  name: string
  description: string
  api_json: Record<string, ComfyUIAPINode> | null
  inputs: ComfyWorkflowInput[] | null
  // outputs: ComfyWorkflowOutput[]
}

export default function ComfuiWorkflowSetting() {
  const { t } = useTranslation()
  const [showAddWorkflowDialog, setShowAddWorkflowDialog] = useState(false)
  const [deleteWorkflowId, setDeleteWorkflowId] = useState<number | null>(null)
  const [editingWorkflow, setEditingWorkflow] = useState<ComfyWorkflow | null>(
    null
  )

  const [workflows, setWorkflows] = useState<ComfyWorkflow[]>([])
  const loadWorkflows = async () => {
    fetch('/api/settings/comfyui/list_workflows')
      .then((res) => res.json())
      .then((data: ComfyWorkflowFromAPI[]) => {
        console.log('ComfyUI workflows:', data)
        const workflows: ComfyWorkflow[] = data.map(
          (workflow: ComfyWorkflowFromAPI) => {
            const inputs = JSON.parse(workflow.inputs ?? '[]')
            const outputs = JSON.parse(workflow.outputs ?? '[]')
            const api_json = JSON.parse(workflow.api_json)
            return {
              ...workflow,
              inputs: inputs,
              outputs: outputs,
              api_json: api_json,
            }
          }
        )
        setWorkflows(workflows)
      })
  }
  useEffect(() => {
    loadWorkflows()
  }, [])
  const handleDeleteWorkflow = (id: number) => {
    fetch(`/api/settings/comfyui/delete_workflow/${id}`, {
      method: 'DELETE',
    })
      .then(() => {
        loadWorkflows()
      })
      .catch((err) => {
        toast.error(`Failed to delete workflow: ${err}`)
        console.error(err)
      })
      .finally(() => {
        setDeleteWorkflowId(null)
      })
  }
  return (
    <div className="space-y-4">
      {deleteWorkflowId && (
        <Dialog
          open={!!deleteWorkflowId}
          onOpenChange={() => setDeleteWorkflowId(null)}
        >
          <DialogContent>
            <p>{t('settings:comfyui.deleteWorkflowConfirmation')}</p>

            <Button onClick={() => handleDeleteWorkflow(deleteWorkflowId)}>
              Delete
            </Button>
          </DialogContent>
        </Dialog>
      )}
      {
        <div className="flex items-center gap-2">
          <PaletteIcon className="w-5 h-5" />
          <p className="text-sm font-bold">{t('settings:comfyui.workflows')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddWorkflowDialog(true)}
          >
            <PlusIcon className="w-4 h-4" />
            {t('settings:comfyui.addWorkflow')}
          </Button>
          {(showAddWorkflowDialog || editingWorkflow) && (
            <AddWorkflowDialog
              workflow={editingWorkflow}
              onClose={() => {
                setShowAddWorkflowDialog(false)
                setEditingWorkflow(null)
                loadWorkflows()
              }}
            />
          )}
        </div>
      }
      {/* Workflows */}
      {workflows.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {workflows.map((workflow) => (
              <div
                key={workflow.id}
                className="flex items-center gap-2 border p-2 rounded-md justify-between"
              >
                <div className="flex flex-col gap-1">
                  <p>{workflow.name}</p>
                  <p className="text-muted-foreground">
                    {workflow.description}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setEditingWorkflow(workflow)
                    }}
                  >
                    <PencilIcon className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setDeleteWorkflowId(workflow.id)
                    }}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

type ComfyUIAPINode = {
  class_type: string
  inputs: Record<string, string | number | boolean | string[] | number[]>
}
function AddWorkflowDialog({
  onClose,
  workflow,
}: {
  onClose: () => void
  workflow: ComfyWorkflow | null
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [workflowName, setWorkflowName] = useState(workflow?.name ?? '')
  const [workflowJson, setWorkflowJson] = useState<Record<
    string,
    ComfyUIAPINode
  > | null>(workflow?.api_json ?? null)
  const [inputs, setInputs] = useState<ComfyWorkflowInput[]>(
    workflow?.inputs ?? []
  )
  const [error, setError] = useState('')
  const [workflowDescription, setWorkflowDescription] = useState(
    workflow?.description ?? ''
  )
  const [outputs, setOutputs] = useState<
    {
      name: string
      type: 'string' | 'number' | 'boolean'
      description: string
    }[]
  >([])
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputs([])
    const file = e.target.files?.[0]
    if (file) {
      try {
        const fileContent = await file.text()
        // Parse the JSON content
        const jsonContent = JSON.parse(fileContent)
        console.log('Parsed workflow JSON:', jsonContent)
        for (const key in jsonContent) {
          const node: ComfyUIAPINode = jsonContent[key]
          if (!node.class_type) {
            toast.error(
              t(
                'settings:comfyui.invalidApiJsonFormat',
                'Invalid API JSON format. You need to export API JSON, not workflow JSON in ComfyUI. Please go to ComfyUI Menu -> Workflow -> Export (API) JSON and try again.'
              )
            )
            return
          }
        }
        setWorkflowJson(jsonContent)
        setWorkflowName(file.name.replace('.json', ''))
      } catch (error) {
        console.error(error)
        toast.error(
          t(
            'settings:comfyui.invalidWorkflowJsonFormat',
            'Invalid workflow JSON, make sure you exprted API JSON in ComfyUI!' +
              error
          )
        )
      }
    }
  }
  const handleSubmit = async () => {
    if (!workflowJson) {
      setError(
        t(
          'settings:comfyui.pleaseUploadWorkflowApiJsonFile',
          'Please upload a workflow API JSON file'
        )
      )
      return
    }
    if (inputs.length === 0) {
      setError(
        t(
          'settings:comfyui.pleaseAddAtLeastOneInput',
          'Please add at least one input'
        )
      )
      return
    }
    if (workflowName === '') {
      setError(
        t(
          'settings:comfyui.pleaseEnterWorkflowName',
          'Please enter a workflow name'
        )
      )
      return
    }
    if (workflowDescription === '') {
      setError(
        t(
          'settings:comfyui.pleaseEnterWorkflowDescription',
          'Please enter a workflow description'
        )
      )
      return
    }
    const matched = workflowName.match(/^[a-zA-Z0-9_]+$/)
    if (!matched) {
      setError(
        t(
          'settings:comfyui.workflowNameInvalid',
          'Workflow Name only allow a-Z, 0-9, _'
        )
      )
      return
    }
    const payload = {
      name: workflowName,
      api_json: workflowJson,
      description: workflowDescription,
      inputs: inputs,
    }
    console.log('发送到后端的数据：', payload)

    if (workflow) {
      // 先删除
      const deleteRes = await fetch(
        `/api/settings/comfyui/delete_workflow/${workflow.id}`,
        {
          method: 'DELETE',
        }
      )
      if (!deleteRes.ok) {
        const data = await deleteRes.json()
        toast.error(`Failed to delete old workflow: ${data.message}`)
        return
      }
    }

    // 再创建
    const createRes = await fetch('/api/settings/comfyui/create_workflow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (createRes.ok) {
      toast.success(
        t(
          'settings:comfyui.workflowUpdatedSuccessfully',
          `Workflow ${workflow ? 'updated' : 'created'} successfully`
        )
      )
      onClose()
    } else {
      const data = await createRes.json()
      toast.error(
        `Failed to ${workflow ? 'update' : 'create'} workflow: ${data.message}`
      )
    }
  }
  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent
        // open={true}
        className="max-w-4xl h-[90vh] flex flex-col p-4"
      >
        <DialogHeader className="flex-shrink-0 pb-2">
          <DialogTitle>
            {workflow
              ? t('settings:comfyui.editWorkflow', 'Edit Workflow')
              : t('settings:comfyui.addWorkflow', 'Add Workflow')}
          </DialogTitle>
          {error && <p className="text-red-500">{error}</p>}
        </DialogHeader>
        
        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-2">
        <Input
          type="text"
          style={{ flexShrink: 0 }}
          placeholder={t(
            'settings:comfyui.workflowName',
            'Workflow Name, only a-Z, 0-9, _ are allowed'
          )}
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
        />
        <Textarea
          placeholder={t(
            'settings:comfyui.workflowDescription',
            'Workflow Description'
          )}
          value={workflowDescription}
          onChange={(e) => setWorkflowDescription(e.target.value)}
        />
        <Button onClick={() => inputRef.current?.click()} variant={'outline'}>
          <UploadIcon className="w-4 h-4 mr-2" />
          {t(
            'settings:comfyui.uploadWorkflowApiJson',
            'Upload Workflow API JSON'
          )}
        </Button>
        <input
          type="file"
          accept=".json"
          ref={inputRef}
          onChange={handleFileChange}
          className="hidden"
        />
        {workflowJson && (
          <Card className="border-2 border-dashed border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center">
                <div className="h-2 w-2 rounded-full bg-primary"></div>
                {t(
                  'settings:comfyui.workflowInputsConfiguration',
                  'Workflow Inputs Configuration'
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {inputs.length > 0 ? (
                <div className="space-y-2">
                  {inputs.map((input, index) => (
                    <Card
                      key={`${input.node_input_name}_${input.node_id}`}
                      className="bg-background/50 border border-border/50"
                    >
                      <CardContent className="space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 space-y-3">
                            {/* Input Name and Required Badge */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <Label className="font-mono text-sm bg-muted px-2 py-1 rounded">
                                {input.name}
                              </Label>
                              <Badge variant="outline" className="text-xs">
                                {input.type}
                              </Badge>
                            </div>

                            <Separator className="my-2" />

                            {/* Default Value */}
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">
                                {t(
                                  'settings:comfyui.defaultValue',
                                  'Default Value'
                                )}
                              </Label>
                              <Input
                                type="text"
                                value={input.default_value.toString()}
                                disabled
                                className="bg-muted/50 text-sm"
                              />
                            </div>

                            {/* Description */}
                            <div className="space-y-2">
                              {/* <Label className="text-xs text-muted-foreground">
                                Description for Users
                              </Label> */}
                              <Textarea
                                placeholder={t(
                                  'settings:comfyui.describeInput',
                                  'Describe what this input does so that LLM can understand it and pass in the correct value...'
                                )}
                                value={input.description}
                                onChange={(e) => {
                                  const newInputs = [...inputs]
                                  newInputs[index].description = e.target.value
                                  setInputs(newInputs)
                                }}
                                className="min-h-[80px] text-sm resize-none"
                              />
                            </div>
                          </div>

                          {/* Controls */}
                          <div className="flex flex-col items-end gap-2">
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id={`required-${index}`}
                                checked={input.required}
                                onCheckedChange={(checked) => {
                                  const newInputs = [...inputs]
                                  newInputs[index].required = !!checked
                                  setInputs(newInputs)
                                }}
                              />
                              <Label
                                htmlFor={`required-${index}`}
                                className="text-xs"
                              >
                                {t('settings:comfyui.required', 'Required')}
                              </Label>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                const newInputs = [...inputs]
                                newInputs.splice(index, 1)
                                setInputs(newInputs)
                              }}
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            >
                              <TrashIcon className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card className="border-dashed border-2 border-muted-foreground/25">
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="rounded-full bg-muted p-3 mb-4">
                      <PlusIcon className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <h3 className="font-medium text-foreground mb-2">
                      {t(
                        'settings:comfyui.noInputsConfigured',
                        'No inputs configured'
                      )}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                      {t(
                        'settings:comfyui.addWorkflowInputsFromNodeParameters',
                        'Add workflow inputs from the node parameters below. Choose at least one input to make this workflow interactive.'
                      )}
                    </p>
                    <Badge variant="outline" className="text-xs">
                      {t(
                        'settings:comfyui.selectParametersFromWorkflowNodes',
                        'Select parameters from the workflow nodes below'
                      )}
                    </Badge>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        )}
        {workflowJson &&
          Object.keys(workflowJson).map((nodeID) => {
            const node = workflowJson[nodeID]
            return (
              <div key={nodeID}>
                <p className="font-bold">
                  {node.class_type} #{nodeID}
                </p>
                <div className="ml-4 flex flex-col gap-1">
                  {Object.keys(node.inputs).map((inputKey) => {
                    const inputValue = node.inputs[inputKey]
                    if (
                      typeof inputValue !== 'boolean' &&
                      typeof inputValue !== 'number' &&
                      typeof inputValue !== 'string'
                    ) {
                      return null
                    }
                    return (
                      <div key={inputKey} className="flex items-center gap-2">
                        <p className="bg-accent text-sm px-2 py-0.5 rounded-md">
                          {inputKey}
                        </p>
                        <Input
                          type="text"
                          value={inputValue.toString()}
                          disabled
                        />
                        <Button
                          variant="outline"
                          size="default"
                          onClick={() => {
                            setInputs([
                              ...inputs.filter(
                                (i) =>
                                  i.node_id !== nodeID ||
                                  i.node_input_name !== inputKey
                              ),
                              {
                                name: `${inputKey}_${nodeID}`,
                                type: typeof inputValue as
                                  | 'string'
                                  | 'number'
                                  | 'boolean',
                                description: '',
                                node_id: nodeID,
                                node_input_name: inputKey,
                                default_value: inputValue,
                                required: false,
                              },
                            ])
                          }}
                        >
                          <PlusIcon className="w-4 h-4" />
                          {t('settings:comfyui.addInput', 'Add Input')}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        
        {/* Fixed Submit Button at the bottom */}
        <div className="flex-shrink-0 mt-2 pt-3 border-t border-border bg-background">
          <Button onClick={handleSubmit} className="w-full">
            {workflow
              ? t('settings:comfyui.save', 'Save')
              : t('settings:comfyui.submit', 'Submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
