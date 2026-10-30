import pandas as pd
import matplotlib.pyplot as plt
import sys


def scatter_plot(df, ax):
    melted = df.melt(id_vars=["Time(sec)"], var_name="Latitude", value_name="Visible")
    melted["Minute"] = melted["Time(sec)"] / 60.0
    melted["Latitude"] = melted["Latitude"].str.replace("Lat", "").astype(float)

    colors = [
        (0.2, 0.4, 0.8, 0 if v == 0 else min(1.0, v / 3))
        for v in melted["Visible"]
    ]

    ax.scatter(melted["Minute"], melted["Latitude"], color=colors, s=10)
    ax.set_xlabel("Minutes")
    ax.set_ylabel("Latitude (deg)")
    ax.set_title("Visibility Over Time")
    ax.set_xlim(df["Time(sec)"].min() / 60.0, df["Time(sec)"].max() / 60.0)


def average_plot(df, ax):
    lat_cols = [c for c in df.columns if c.startswith("Lat")]
    lats = [float(c.replace("Lat", "")) for c in lat_cols]
    avgs = [df[c].mean() for c in lat_cols]
    ax.plot(avgs, lats)
    ax.set_xlabel("Average Visible Satellites")
    ax.set_ylabel("Latitude (deg)")
    ax.set_title("Daily Average")
    ax.set_xlim(left=0)


def main(csv_file: str):
    df = pd.read_csv(csv_file)
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 6), sharey=True)
    scatter_plot(df, ax1)
    average_plot(df, ax2)
    plt.tight_layout()
    plt.show()


if __name__ == "__main__":
    file = sys.argv[1] if len(sys.argv) > 1 else "lat_visibility_report.csv"
    main(file)
