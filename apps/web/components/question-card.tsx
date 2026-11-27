"use client"

import { type AskUserToolPart } from "@/tools"
import { usePlaySound } from "@/components/ui/sensory-ui/config/use-play-sound"
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire"

export function QuestionCard({
  part,
  onAnswer,
}: {
  part: AskUserToolPart
  onAnswer: (
    toolCallId: string,
    answers: { question: string; answer: string }[]
  ) => void
}) {
  const questions = part.state === "input-available" ? part.input.questions : []
  const { play } = usePlaySound({ sound: "interaction.confirm" })

  return (
    <div className="sticky bottom-2 isolate z-50 mx-auto w-full max-w-[700px] px-5 pt-2 sm:px-6">
      <div className="w-full rounded-none border border-border border-l-2 border-l-primary bg-popover p-4 text-sm text-popover-foreground shadow-md">
        {questions.length === 0 ? (
          <div className="flex shimmer items-center gap-2 py-2 text-muted-foreground">
            Preparando pregunta…
          </div>
        ) : (
          <Questionnaire
            key={part.toolCallId}
            defaultItem="q0"
            items={questions.map((question, index) => ({
              choices: question.choices.map((choice) => ({ value: choice })),
              name: `q${index}`,
              required: true,
            }))}
            onSubmit={(event) => {
              event.preventDefault()
              play()
              const formData = new FormData(event.currentTarget)
              onAnswer(
                part.toolCallId,
                questions.map((question, index) => ({
                  question: question.question,
                  answer: String(formData.get(`q${index}`) ?? ""),
                }))
              )
            }}
          >
            {questions.length > 1 && (
              <QuestionnaireProgress className="-mb-4" />
            )}
            {questions.map((question, index) => (
              <QuestionnaireItem key={index} name={`q${index}`} required>
                <QuestionnaireTitle>{question.question}</QuestionnaireTitle>
                <QuestionnaireChoices>
                  {question.choices.map((choice) => (
                    <QuestionnaireChoice
                      key={choice}
                      value={choice}
                      className="rounded-none"
                    >
                      {choice}
                    </QuestionnaireChoice>
                  ))}
                  <QuestionnaireInput
                    aria-label="Otra respuesta"
                    placeholder="Escribí otra respuesta…"
                    className="rounded-none"
                  />
                </QuestionnaireChoices>
                <QuestionnaireError />
              </QuestionnaireItem>
            ))}
            <QuestionnaireActions className="border-t border-border pt-3">
              <QuestionnairePrevious className="rounded-none">
                Anterior
              </QuestionnairePrevious>
              <QuestionnaireNext className="rounded-none">
                Siguiente
              </QuestionnaireNext>
              <QuestionnaireSubmit className="rounded-none">
                Responder
              </QuestionnaireSubmit>
            </QuestionnaireActions>
          </Questionnaire>
        )}
      </div>
    </div>
  )
}
