import ReactECharts from "echarts-for-react";

export default function GlobalCoverageAnalysis() {
  const option = {
    title: {
      text: "全球カバレッジ解析",
      textStyle: {
        color: "#ed6d00"
      }
    },
    backgroundColor: "rgba(30, 32, 36, 0.95)",
    textStyle: {
      color: "#f1f1f1"
    },
    tooltip: { formatter: "{b}: {c}%" },
    series: [{
      type: "pie",
      radius: ["40%", "70%"],
      data: [
        { value: 85, name: "Coverage", itemStyle: { color: "#ed6d00" } },
        { value: 15, name: "Gap", itemStyle: { color: "#444753" } }
      ],
      label: { color: "#f1f1f1" }
    }]
  };

  return (
    <ReactECharts 
      option={option}
      style={{ height: "100%", width: "100%" }}
      theme="dark"
    />
  );
}