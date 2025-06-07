import ReactECharts from "echarts-for-react";

export default function GlobalAvailabilityAnalysis() {
  const option = {
    title: {
      text: "全球可用性解析",
      textStyle: {
        color: "#ed6d00"
      }
    },
    backgroundColor: "rgba(30, 32, 36, 0.95)",
    textStyle: {
      color: "#f1f1f1"
    },
    xAxis: {
      type: "category",
      data: ["A", "B", "C", "D", "E"],
      axisLabel: { color: "#999faa" }
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#999faa" }
    },
    series: [{
      data: [20, 40, 30, 50, 25],
      type: "bar",
      itemStyle: { color: "#ed6d00" }
    }],
    grid: { left: 60, right: 20, top: 60, bottom: 40 }
  };

  return (
    <ReactECharts 
      option={option}
      style={{ height: "100%", width: "100%" }}
      theme="dark"
    />
  );
}