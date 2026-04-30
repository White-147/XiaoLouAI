import React, { useState } from 'react'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
export default function WritePlanToolCall({ args }: { args: string }) {
  const [isExpanded, setIsExpanded] = useState(true)
  const { t } = useTranslation()

  let parsedArgs: {
    steps: {
      title: string
      description: string
    }[]
  } | null = null

  try {
    parsedArgs = JSON.parse(args)
  } catch (error) {
    void error
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/[0.92] shadow-[0_14px_34px_rgba(15,23,42,0.08)] backdrop-blur-sm dark:border-white/10 dark:bg-slate-900/[0.86]">
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between gap-3 border-b border-slate-100 px-3.5 py-3 transition-colors hover:bg-slate-50/80 dark:border-white/10 dark:hover:bg-white/5"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-violet-200/80 bg-violet-50 p-1.5 dark:border-violet-400/20 dark:bg-violet-400/10">
            <FileText className="h-4 w-4 text-violet-600 dark:text-violet-300" />
          </div>

          <p className="text-[15px] font-semibold tracking-tight text-slate-950 dark:text-slate-100">
            {t('chat:plan.title')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {parsedArgs && (
            <div className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-400/15 dark:text-violet-200">
              {parsedArgs.steps.length}
            </div>
          )}
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          )}
        </div>
      </div>

      {/* Collapsible Content */}
      {isExpanded && (
        <div>
          <div className="space-y-2.5 p-3">
            {parsedArgs?.steps.map((step, index) => (
              <div
                key={`${step.title}-${index}`}
                className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 transition-shadow hover:shadow-sm dark:border-white/10 dark:bg-white/5"
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-violet-200 bg-white text-xs font-semibold text-violet-700 shadow-sm dark:border-violet-400/20 dark:bg-slate-950 dark:text-violet-200">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="mb-1 text-[15px] font-semibold leading-6 text-slate-950 dark:text-slate-100">
                      {step.title}
                    </h4>
                    {step.description && (
                      <p className="text-[14px] leading-6 text-slate-600 dark:text-slate-300">
                        {step.description}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
