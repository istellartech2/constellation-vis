import ReactECharts from "echarts-for-react";

export default function SolarImpactAnalysis() {
  const option = {
    title: {
      text: "太陽光影響解析",
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
      data: ["Q1", "Q2", "Q3", "Q4"],
      axisLabel: { color: "#999faa" }
    },
    yAxis: {
      type: "value",
      name: "Solar Exposure (%)",
      nameTextStyle: { color: "#999faa" },
      axisLabel: { color: "#999faa" }
    },
    series: [{
      data: [85, 90, 88, 92],
      type: "line",
      smooth: true,
      lineStyle: { color: "#ed6d00", width: 3 },
      areaStyle: { color: "rgba(237, 109, 0, 0.3)" }
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