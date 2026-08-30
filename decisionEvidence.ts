export interface EvidenceStepInputs {
  dataRetrieved: boolean;
  financialStatementsChecked: boolean;
  ratiosCalculated: boolean;
  bookValueChecked: boolean;
  marketValueChecked: boolean;
  newsChecked: boolean;
  disclosuresChecked: boolean; // KAP / SEC
  technicalAnalysisDone: boolean;
  macroAnalysisDone: boolean;
  riskAnalysisDone: boolean;
  recommendationGenerated: boolean;
}

export interface EvidenceStep {
  step: string;
  completed: boolean;
}

/**
 * Every entry here corresponds to a real function call in the pipeline
 * that produced the recommendation — this is a status report, not a
 * decorative animation. A step marked false means that data source truly
 * wasn't reachable/configured for this run.
 */
export function buildDecisionEvidence(inputs: EvidenceStepInputs): EvidenceStep[] {
  return [
    { step: "Data retrieved from configured market-data provider", completed: inputs.dataRetrieved },
    { step: "Financial statements checked", completed: inputs.financialStatementsChecked },
    { step: "Fundamental ratios calculated", completed: inputs.ratiosCalculated },
    { step: "Book value checked", completed: inputs.bookValueChecked },
    { step: "Market value checked", completed: inputs.marketValueChecked },
    { step: "News checked", completed: inputs.newsChecked },
    { step: "KAP / SEC disclosures checked", completed: inputs.disclosuresChecked },
    { step: "Technical analysis run", completed: inputs.technicalAnalysisDone },
    { step: "Macro analysis run", completed: inputs.macroAnalysisDone },
    { step: "Portfolio risk analysis run", completed: inputs.riskAnalysisDone },
    { step: "Recommendation generated", completed: inputs.recommendationGenerated },
  ];
}
