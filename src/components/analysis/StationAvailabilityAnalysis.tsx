import ReactECharts from "echarts-for-react";

export default function StationAvailabilityAnalysis() {
  const option = {
    title: {
      text: "特定局可用性解析",
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
      data: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      axisLabel: { color: "#999faa" }
    },
    yAxis: {
      type: "value",
      name: "Availability %",
      nameTextStyle: { color: "#999faa" },
      axisLabel: { color: "#999faa" }
    },
    series: [{
      data: [98, 95, 99, 97, 96, 94, 98],
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