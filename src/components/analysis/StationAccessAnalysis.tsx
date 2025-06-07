import ReactECharts from "echarts-for-react";

export default function StationAccessAnalysis() {
  const option = {
    title: {
      text: "特定局アクセス解析",
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
      data: ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "24:00"],
      axisLabel: { color: "#999faa" }
    },
    yAxis: {
      type: "value",
      name: "Visible Satellites",
      nameTextStyle: { color: "#999faa" },
      axisLabel: { color: "#999faa" }
    },
    series: [{
      data: [2, 5, 8, 6, 4, 7, 3],
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